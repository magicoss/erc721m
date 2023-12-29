//SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./IERC1155M.sol";

/**
 * @title ERC1155M
 *
 * @dev ERC1155 subclass with MagicEden launchpad features including
 *  - multiple minting stages with time-based auto stage switch
 *  - global and stage wallet-level minting limit
 *  - whitelist using merkle tree
 *  - crossmint support
 *  - anti-botting
 */
contract ERC1155M is IERC1155M, ERC1155Supply, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;

    // Whether this contract is mintable.
    bool private _mintable;

    // Whether base URI is permanent. Once set, base URI is immutable.
    bool private _baseURIPermanent;

    // Specify how long a signature from cosigner is valid for, recommend 300 seconds.
    uint64 private _timestampExpirySeconds;

    // The address of the cosigner server.
    address private _cosigner;

    // The crossmint address. Need to set if using crossmint.
    address private _crossmintAddress;

    // The total mintable supplies.
    uint256[] internal _maxMintableSupplies;

    // Global wallet limit, across all stages.
    uint256[] private _globalWalletLimits;

    // Current base URI.
    string private _currentBaseURI;

    // The suffix for the token URL, e.g. ".json".
    string private _tokenURISuffix;

    // Token balance.
    uint256[] private _tokens;

    // Mint stage infomation. See MintStageInfo for details.
    MintStageInfo[] private _mintStages;

    // Minted count per stage per wallet.
    mapping(uint256 => mapping(address => uint32[]))
        private _stageMintedCountsPerWallet;

    // Minted count per stage.
    mapping(uint256 => uint256[]) private _stageMintedCounts;

    constructor(
        string memory tokenURISuffix,
        uint256[] memory maxMintableSupplies,
        uint256[] memory globalWalletLimits,
        address cosigner,
        uint64 timestampExpirySeconds
    ) ERC1155("") {
        if (maxMintableSupplies.length != globalWalletLimits.length)
            revert InvalidInputLength();

        for (uint256 i = 0; i < maxMintableSupplies.length; ++i) {
            if (globalWalletLimits[i] > maxMintableSupplies[i])
                revert GlobalWalletLimitOverflow();
        }

        _mintable = false;
        _maxMintableSupplies = maxMintableSupplies;
        _globalWalletLimits = globalWalletLimits;
        _tokenURISuffix = tokenURISuffix;
        _cosigner = cosigner; // ethers.constants.AddressZero for no cosigning
        _timestampExpirySeconds = timestampExpirySeconds;
    }

    /**
     * @dev Returns whether mintable.
     */
    modifier canMint() {
        if (!_mintable) revert NotMintable();
        _;
    }

    /**
     * @dev Returns whether NOT mintable.
     */
    modifier cannotMint() {
        if (_mintable) revert Mintable();
        _;
    }

    /**
     * @dev Returns whether it has enough supply for the given qty.
     */
    modifier hasSupply(uint32[] memory tokenIds, uint32[] memory amounts) {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (
                totalSupply(tokenIds[i]) + amounts[i] >
                _maxMintableSupplies[tokenIds[i]]
            ) revert NoSupplyLeft();
        }
        _;
    }

    /**
     * @dev Returns cosigner address.
     */
    function getCosigner() external view override returns (address) {
        return _cosigner;
    }

    /**
     * @dev Returns cosign nonce.
     */
    function getCosignNonce(address minter) public view returns (uint256) {
        uint256[] memory totalMinted = this.totalMintedByAddress(minter);
        uint256 sum = 0;

        for (uint256 i = 0; i < totalMinted.length; ++i) {
            sum = sum + totalMinted[i];
        }
        return sum;
    }

    /**
     * @dev Sets cosigner.
     */
    function setCosigner(address cosigner) external onlyOwner {
        _cosigner = cosigner;
        emit SetCosigner(cosigner);
    }

    /**
     * @dev Returns expiry in seconds.
     */
    function getTimestampExpirySeconds() public view override returns (uint64) {
        return _timestampExpirySeconds;
    }

    /**
     * @dev Sets expiry in seconds. This timestamp specifies how long a signature from cosigner is valid for.
     */
    function setTimestampExpirySeconds(uint64 expiry) external onlyOwner {
        _timestampExpirySeconds = expiry;
        emit SetTimestampExpirySeconds(expiry);
    }

    /**
     * @dev Returns crossmint address.
     */
    function getCrossmintAddress() external view override returns (address) {
        return _crossmintAddress;
    }

    /**
     * @dev Sets crossmint address if using crossmint. This allows the specified address to call `crossmint`.
     */
    function setCrossmintAddress(address crossmintAddress) external onlyOwner {
        _crossmintAddress = crossmintAddress;
        emit SetCrossmintAddress(crossmintAddress);
    }

    /**
     * @dev Sets stages in the format of an array of `MintStageInfo`.
     *
     * Following is an example of launch with two stages. The first stage is exclusive for whitelisted wallets
     * specified by merkle root.
     *    [{
     *      price: 10000000000000000000,
     *      maxStageSupply: 2000,
     *      walletLimit: 1,
     *      merkleRoot: 0x559fadeb887449800b7b320bf1e92d309f329b9641ac238bebdb74e15c0a5218,
     *      startTimeUnixSeconds: 1667768000,
     *      endTimeUnixSeconds: 1667771600,
     *     },
     *     {
     *      price: 20000000000000000000,
     *      maxStageSupply: 3000,
     *      walletLimit: 2,
     *      merkleRoot: 0,
     *      startTimeUnixSeconds: 1667771600,
     *      endTimeUnixSeconds: 1667775200,
     *     }
     * ]
     */
    function setStages(MintStageInfo[] calldata newStages) external onlyOwner {
        uint256 originalSize = _mintStages.length;
        for (uint256 i = 0; i < originalSize; i++) {
            _mintStages.pop();
        }

        uint64 timestampExpirySeconds = getTimestampExpirySeconds();
        for (uint256 i = 0; i < newStages.length; i++) {
            if (i >= 1) {
                if (
                    newStages[i].startTimeUnixSeconds <
                    newStages[i - 1].endTimeUnixSeconds + timestampExpirySeconds
                ) {
                    revert InsufficientStageTimeGap();
                }
            }
            _assertValidStartAndEndTimestamp(
                newStages[i].startTimeUnixSeconds,
                newStages[i].endTimeUnixSeconds
            );
            _mintStages.push(
                MintStageInfo({
                    prices: newStages[i].prices,
                    walletLimits: newStages[i].walletLimits,
                    merkleRoots: newStages[i].merkleRoots,
                    maxStageSupplies: newStages[i].maxStageSupplies,
                    startTimeUnixSeconds: newStages[i].startTimeUnixSeconds,
                    endTimeUnixSeconds: newStages[i].endTimeUnixSeconds
                })
            );
            emit UpdateStage(
                i,
                newStages[i].prices,
                newStages[i].walletLimits,
                newStages[i].merkleRoots,
                newStages[i].maxStageSupplies,
                newStages[i].startTimeUnixSeconds,
                newStages[i].endTimeUnixSeconds
            );
        }
    }

    /**
     * @dev Gets whether mintable.
     */
    function getMintable() external view override returns (bool) {
        return _mintable;
    }

    /**
     * @dev Sets mintable.
     */
    function setMintable(bool mintable) external onlyOwner {
        _mintable = mintable;
        emit SetMintable(mintable);
    }

    /**
     * @dev Returns number of stages.
     */
    function getNumberStages() external view override returns (uint256) {
        return _mintStages.length;
    }

    /**
     * @dev Returns maximum mintable supplies.
     */
    function getMaxMintableSupplies()
        external
        view
        override
        returns (uint256[] memory)
    {
        return _maxMintableSupplies;
    }

    /**
     * @dev Sets maximum mintable supplies.
     *
     * New supply cannot be larger than the old.
     */
    function setMaxMintableSupplies(
        uint256[] calldata maxMintableSupplies
    ) external virtual onlyOwner {
        if (maxMintableSupplies.length != _maxMintableSupplies.length)
            revert InvalidInputLength();

        uint256 size = _maxMintableSupplies.length;
        for (uint256 i = 0; i < size; i++) {
            if (maxMintableSupplies[i] > _maxMintableSupplies[i])
                revert CannotIncreaseMaxMintableSupplies();
            _maxMintableSupplies[i] = maxMintableSupplies[i];
        }
        emit SetMaxMintableSupplies(maxMintableSupplies);
    }

    /**
     * @dev Returns global wallet limits. This is the max number of tokens can be minted by one wallet.
     */
    function getGlobalWalletLimits()
        external
        view
        override
        returns (uint256[] memory)
    {
        return _globalWalletLimits;
    }

    /**
     * @dev Sets global wallet limits.
     */
    function setGlobalWalletLimits(
        uint256[] calldata globalWalletLimits
    ) external onlyOwner {
        if (globalWalletLimits.length != _globalWalletLimits.length)
            revert InvalidInputLength();

        uint256 size = _globalWalletLimits.length;
        for (uint256 i = 0; i < size; i++) {
            if (globalWalletLimits[i] > _maxMintableSupplies[i])
                revert GlobalWalletLimitOverflow();
            _globalWalletLimits[i] = globalWalletLimits[i];
        }

        emit SetGlobalWalletLimits(globalWalletLimits);
    }

    /**
     * @dev Returns numbers of minted token for a given address.
     */
    function totalMintedByAddress(
        address a
    ) external view virtual override returns (uint256[] memory) {
        uint256[] memory balances = new uint256[](_tokens.length);

        for (uint256 i = 0; i < _tokens.length; ++i) {
            balances[i] = balanceOf(a, i);
        }

        return balances;
    }

    /**
     * @dev Returns info for one stage specified by index (starting from 0).
     */
    function getStageInfo(
        uint256 index
    )
        external
        view
        override
        returns (MintStageInfo memory, uint32[] memory, uint256[] memory)
    {
        if (index >= _mintStages.length) {
            revert("InvalidStage");
        }
        uint32[] memory walletMinted = _stageMintedCountsPerWallet[index][
            msg.sender
        ];
        uint256[] memory stageMinted = _stageMintedCounts[index];
        return (_mintStages[index], walletMinted, stageMinted);
    }

    /**
     * @dev Updates info for one stage specified by index (starting from 0).
     */
    function updateStage(
        uint256 index,
        uint80[] calldata prices,
        uint32[] calldata walletLimits,
        bytes32[] calldata merkleRoots,
        uint24[] calldata maxStageSupplies,
        uint64 startTimeUnixSeconds,
        uint64 endTimeUnixSeconds
    ) external onlyOwner {
        if (index >= _mintStages.length) revert InvalidStage();
        if (index >= 1) {
            if (
                startTimeUnixSeconds <
                _mintStages[index - 1].endTimeUnixSeconds +
                    getTimestampExpirySeconds()
            ) {
                revert InsufficientStageTimeGap();
            }
        }
        _assertValidStartAndEndTimestamp(
            startTimeUnixSeconds,
            endTimeUnixSeconds
        );
        _mintStages[index].prices = prices;
        _mintStages[index].walletLimits = walletLimits;
        _mintStages[index].merkleRoots = merkleRoots;
        _mintStages[index].maxStageSupplies = maxStageSupplies;
        _mintStages[index].startTimeUnixSeconds = startTimeUnixSeconds;
        _mintStages[index].endTimeUnixSeconds = endTimeUnixSeconds;

        emit UpdateStage(
            index,
            prices,
            walletLimits,
            merkleRoots,
            maxStageSupplies,
            startTimeUnixSeconds,
            endTimeUnixSeconds
        );
    }

    /**
     * @dev Mints token(s).
     *
     * tokenIds - token ids to be mint
     * amounts - number of tokens to mint
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     * timestamp - the current timestamp
     * signature - the signature from cosigner if using cosigner.
     */
    function mint(
        uint32 tokenId,
        uint32 amount,
        bytes32[][] calldata proof,
        uint64 timestamp,
        bytes calldata signature
    ) external payable nonReentrant {
        _mintInternal(
            _asSingletonArray(tokenId),
            _asSingletonArray(amount),
            msg.sender,
            proof,
            timestamp,
            signature
        );
    }

    /**
     * @dev Mints token(s).
     *
     * tokenIds - token ids to be mint
     * amounts - number of tokens to mint
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     * timestamp - the current timestamp
     * signature - the signature from cosigner if using cosigner.
     */
    function mintBatch(
        uint32[] calldata tokenIds,
        uint32[] calldata amounts,
        bytes32[][] calldata proof,
        uint64 timestamp,
        bytes calldata signature
    ) external payable nonReentrant {
        _mintInternal(
            tokenIds,
            amounts,
            msg.sender,
            proof,
            timestamp,
            signature
        );
    }

    /**
     * @dev Mints token(s) through crossmint. This function is supposed to be called by crossmint.
     *
     * qty - number of tokens to mint
     * to - the address to mint tokens to
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     * timestamp - the current timestamp
     * signature - the signature from cosigner if using cosigner.
     */
    function crossmint(
        uint32 tokenId,
        uint32 amount,
        address to,
        bytes32[] calldata proof,
        uint64 timestamp,
        bytes calldata signature
    ) external payable nonReentrant {
        if (_crossmintAddress == address(0)) revert CrossmintAddressNotSet();

        // Check the caller is Crossmint
        if (msg.sender != _crossmintAddress) revert CrossmintOnly();

        _mintInternal(
            _asSingletonArray(tokenId),
            _asSingletonArray(amount),
            to,
            _asSingletonArray(proof),
            timestamp,
            signature
        );
    }

    /**
     * @dev Implementation of minting.
     */
    function _mintInternal(
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        address to,
        bytes32[][] memory proof,
        uint64 timestamp,
        bytes calldata signature
    ) internal canMint hasSupply(tokenIds, amounts) {
        if (
            tokenIds.length != amounts.length || tokenIds.length != proof.length
        ) revert InvalidInputLength();

        uint64 stageTimestamp = uint64(block.timestamp);

        MintStageInfo memory stage;
        if (_cosigner != address(0)) {
            assertValidCosign(
                msg.sender,
                tokenIds,
                amounts,
                timestamp,
                signature
            );
            _assertValidTimestamp(timestamp);
            stageTimestamp = timestamp;
        }

        uint256 activeStage = getActiveStageFromTimestamp(stageTimestamp);

        stage = _mintStages[activeStage];

        // Check value
        _checkMintValue(tokenIds, amounts, stage);

        // Check stage supply if applicable
        _checkStageSupply(tokenIds, amounts, activeStage, stage);

        // Check global wallet limit if applicable
        _checkGlobalWalletLimit(to, tokenIds, amounts);

        // Check wallet limit for stage if applicable
        _checkStageWalltLimit(to, tokenIds, amounts, activeStage, stage);

        // Check merkle proof if applicable, merkleRoot == 0x00...00 means no proof required
        _checkMerkleProof(to, tokenIds, proof, stage);

        for (uint256 i = 0; i < tokenIds.length; ++i) {
            _stageMintedCountsPerWallet[activeStage][to][
                tokenIds[i]
            ] += amounts[i];
            _stageMintedCounts[activeStage][tokenIds[i]] += amounts[i];
        }

        _mintBatch(
            to,
            _convertUint32toUInt256Array(tokenIds),
            _convertUint32toUInt256Array(amounts),
            ""
        );
    }

    /**
     * @dev Mints token(s) by owner.
     *
     * NOTE: This function bypasses validations thus only available for owner.
     * This is typically used for owner to  pre-mint or mint the remaining of the supply.
     */
    function ownerMint(
        uint32[] calldata tokenIds,
        uint32[] calldata amounts,
        address to
    ) external onlyOwner hasSupply(tokenIds, amounts) {
        _mintBatch(
            to,
            _convertUint32toUInt256Array(tokenIds),
            _convertUint32toUInt256Array(amounts),
            ""
        );
    }

    /**
     * @dev Withdraws funds by owner.
     */
    function withdraw() external onlyOwner {
        uint256 value = address(this).balance;
        (bool success, ) = msg.sender.call{value: value}("");
        if (!success) revert WithdrawFailed();
        emit Withdraw(value);
    }

    /**
     * @dev Sets token base URI.
     */
    function setBaseURI(string calldata baseURI) external onlyOwner {
        if (_baseURIPermanent) revert CannotUpdatePermanentBaseURI();
        _currentBaseURI = baseURI;
        emit SetBaseURI(baseURI);
    }

    /**
     * @dev Sets token base URI permanent. Cannot revert.
     */
    function setBaseURIPermanent() external onlyOwner {
        _baseURIPermanent = true;
        emit PermanentBaseURI(_currentBaseURI);
    }

    /**
     * @dev Returns token URI suffix.
     */
    function getTokenURISuffix()
        external
        view
        override
        returns (string memory)
    {
        return _tokenURISuffix;
    }

    /**
     * @dev Sets token URI suffix. e.g. ".json".
     */
    function setTokenURISuffix(string calldata suffix) external onlyOwner {
        _tokenURISuffix = suffix;
    }

    /**
     * @dev Returns token URI for a given token id.
     */
    function uri(
        uint256 tokenId
    ) public view virtual override returns (string memory) {
        if (!exists(tokenId)) revert URIQueryForNonexistentToken();

        string memory baseURI = _currentBaseURI;
        return
            bytes(baseURI).length != 0
                ? string(
                    abi.encodePacked(
                        baseURI,
                        _toString(tokenId),
                        _tokenURISuffix
                    )
                )
                : "";
    }

    /**
     * @dev Returns data hash for the given minter, qty and timestamp.
     */
    function getCosignDigest(
        address minter,
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        uint64 timestamp
    ) public view returns (bytes32) {
        if (_cosigner == address(0)) revert CosignerNotSet();
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    minter,
                    tokenIds,
                    amounts,
                    _cosigner,
                    timestamp,
                    _chainID(),
                    getCosignNonce(minter)
                )
            ).toEthSignedMessageHash();
    }

    /**
     * @dev Validates the the given signature.
     */
    function assertValidCosign(
        address minter,
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        uint64 timestamp,
        bytes memory signature
    ) public view override {
        if (
            !SignatureChecker.isValidSignatureNow(
                _cosigner,
                getCosignDigest(minter, tokenIds, amounts, timestamp),
                signature
            )
        ) revert InvalidCosignSignature();
    }

    /**
     * @dev Returns the current active stage based on timestamp.
     */
    function getActiveStageFromTimestamp(
        uint64 timestamp
    ) public view override returns (uint256) {
        for (uint256 i = 0; i < _mintStages.length; i++) {
            if (
                timestamp >= _mintStages[i].startTimeUnixSeconds &&
                timestamp < _mintStages[i].endTimeUnixSeconds
            ) {
                return i;
            }
        }
        revert InvalidStage();
    }

    /**
     * @dev Validates the timestamp is not expired.
     */
    function _assertValidTimestamp(uint64 timestamp) internal view {
        if (timestamp < block.timestamp - getTimestampExpirySeconds())
            revert TimestampExpired();
    }

    /**
     * @dev Validates the start timestamp is before end timestamp. Used when updating stages.
     */
    function _assertValidStartAndEndTimestamp(
        uint64 start,
        uint64 end
    ) internal pure {
        if (start >= end) revert InvalidStartAndEndTimestamp();
    }

    function _checkMintValue(
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        MintStageInfo memory stage
    ) internal view {
        uint256 cost = 0;
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            cost = cost + stage.prices[tokenIds[i]] * amounts[i]; // Let index out of bounds throw
        }
        if (msg.value < cost) revert NotEnoughValue();
    }

    function _checkStageSupply(
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        uint256 activeStage,
        MintStageInfo memory stage
    ) internal view {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (stage.maxStageSupplies[tokenIds[i]] > 0) {
                if (
                    _stageMintedCounts[activeStage][tokenIds[i]] + amounts[i] >
                    stage.maxStageSupplies[tokenIds[i]]
                ) revert StageSupplyExceeded();
            }
        }
    }

    function _checkGlobalWalletLimit(
        address to,
        uint32[] memory tokenIds,
        uint32[] memory amounts
    ) internal view {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (_globalWalletLimits[tokenIds[i]] > 0) {
                if (
                    this.totalMintedByAddress(to)[tokenIds[i]] + amounts[i] >
                    _globalWalletLimits[tokenIds[i]]
                ) revert WalletGlobalLimitExceeded();
            }
        }
    }

    function _checkStageWalltLimit(
        address to,
        uint32[] memory tokenIds,
        uint32[] memory amounts,
        uint256 activeStage,
        MintStageInfo memory stage
    ) internal view {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (stage.walletLimits[tokenIds[i]] > 0) {
                if (
                    _stageMintedCountsPerWallet[activeStage][to][tokenIds[i]] +
                        amounts[i] >
                    stage.walletLimits[tokenIds[i]]
                ) revert WalletStageLimitExceeded();
            }
        }
    }

    function _checkMerkleProof(
        address to,
        uint32[] memory tokenIds,
        bytes32[][] memory proof,
        MintStageInfo memory stage
    ) internal pure {
        for (uint256 i = 0; i < tokenIds.length; ++i) {
            if (stage.merkleRoots[tokenIds[i]] != 0) {
                if (
                    MerkleProof.processProof(
                        proof[i],
                        keccak256(abi.encodePacked(to)) // Question: is this enough? Should include tokenId?
                    ) != stage.merkleRoots[tokenIds[i]]
                ) revert InvalidProof();
            }
        }
    }

    /**
     * @dev Returns chain id.
     */
    function _chainID() private view returns (uint256) {
        uint256 chainID;
        assembly {
            chainID := chainid()
        }
        return chainID;
    }

    function _asSingletonArray(
        uint32 element
    ) private pure returns (uint32[] memory) {
        uint32[] memory array = new uint32[](1);
        array[0] = element;
        return array;
    }

    function _asSingletonArray(
        bytes32[] memory element
    ) private pure returns (bytes32[][] memory) {
        bytes32[][] memory array = new bytes32[][](1);
        array[0] = element;
        return array;
    }

    function _convertUint32toUInt256Array(
        uint32[] memory array32
    ) private pure returns (uint256[] memory array256) {
        for (uint256 i = 0; i < array32.length; ++i) {
            array256[i] = array32[i];
        }
        return array256;
    }

    /**
     * @dev Converts a uint256 to its ASCII string decimal representation.
     */
    function _toString(
        uint256 value
    ) internal pure virtual returns (string memory str) {
        assembly {
            // The maximum value of a uint256 contains 78 digits (1 byte per digit), but
            // we allocate 0xa0 bytes to keep the free memory pointer 32-byte word aligned.
            // We will need 1 word for the trailing zeros padding, 1 word for the length,
            // and 3 words for a maximum of 78 digits. Total: 5 * 0x20 = 0xa0.
            let m := add(mload(0x40), 0xa0)
            // Update the free memory pointer to allocate.
            mstore(0x40, m)
            // Assign the `str` to the end.
            str := sub(m, 0x20)
            // Zeroize the slot after the string.
            mstore(str, 0)

            // Cache the end of the memory to calculate the length later.
            let end := str

            // We write the string from rightmost digit to leftmost digit.
            // The following is essentially a do-while loop that also handles the zero case.
            // prettier-ignore
            for { let temp := value } 1 {} {
                str := sub(str, 1)
                // Write the character to the pointer.
                // The ASCII index of the '0' character is 48.
                mstore8(str, add(48, mod(temp, 10)))
                // Keep dividing `temp` until zero.
                temp := div(temp, 10)
                // prettier-ignore
                if iszero(temp) { break }
            }

            let length := sub(end, str)
            // Move the pointer 32 bytes leftwards to make room for the length.
            str := sub(str, 0x20)
            // Store the length.
            mstore(str, length)
        }
    }
}
