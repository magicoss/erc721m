//SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ERC721A, ERC721AQueryable, ERC721A__IERC721Receiver} from "erc721a/contracts/extensions/ERC721AQueryable.sol";
import {IERC721A, IERC721M} from "./IERC721M.sol";
import {UpdatableOperatorFilterer} from "operator-filter-registry/src/UpdatableOperatorFilterer.sol";
import {CANONICAL_OPERATOR_FILTER_REGISTRY_ADDRESS, ME_SUBSCRIPTION} from "./utils/Constants.sol";

/**
 * @title ERC721MLite
 *
 * @dev Lite version of ERC721M, without the following features:
 * - crossminting
 * - update a speficic stage
 */
contract ERC721MLite is
    IERC721M,
    ERC721AQueryable,
    UpdatableOperatorFilterer,
    Ownable,
    ReentrancyGuard
{
    using ECDSA for bytes32;

    // Whether this contract is mintable.
    bool private _mintable;

    // Specify how long a signature from cosigner is valid for, recommend 300 seconds.
    uint64 private _timestampExpirySeconds;

    // The address of the cosigner server.
    address private _cosigner;

    // The total mintable supply.
    uint256 internal _maxMintableSupply;

    // Global wallet limit, across all stages.
    uint256 private _globalWalletLimit;

    // Current base URI.
    string private _currentBaseURI;

    // The suffix for the token URL, e.g. ".json".
    string private _tokenURISuffix;

    // Mint stage infomation. See MintStageInfo for details.
    MintStageInfo[] private _mintStages;

    // Minted count per stage per wallet.
    mapping(uint256 => mapping(address => uint32))
        private _stageMintedCountsPerWallet;

    // Minted count per stage.
    mapping(uint256 => uint256) private _stageMintedCounts;

    constructor(
        string memory collectionName,
        string memory collectionSymbol,
        string memory tokenURISuffix,
        uint256 maxMintableSupply,
        uint256 globalWalletLimit,
        address cosigner,
        uint64 timestampExpirySeconds
    )
        UpdatableOperatorFilterer(
            CANONICAL_OPERATOR_FILTER_REGISTRY_ADDRESS,
            ME_SUBSCRIPTION,
            true
        )
        ERC721A(collectionName, collectionSymbol)
    {
        if (globalWalletLimit > maxMintableSupply)
            revert GlobalWalletLimitOverflow();
        _mintable = false;
        _maxMintableSupply = maxMintableSupply;
        _globalWalletLimit = globalWalletLimit;
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
     * @dev Returns whether it has enough supply for the given qty.
     */
    modifier hasSupply(uint256 qty) {
        if (totalSupply() + qty > _maxMintableSupply) revert NoSupplyLeft();
        _;
    }

    /**
     * @dev Returns cosign nonce.
     */
    function getCosignNonce(address minter) public view returns (uint256) {
        return _numberMinted(minter);
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

        for (uint256 i = 0; i < newStages.length; i++) {
            if (i >= 1) {
                if (
                    newStages[i].startTimeUnixSeconds <
                    newStages[i - 1].endTimeUnixSeconds +
                        _timestampExpirySeconds
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
                    price: newStages[i].price,
                    mintFee: newStages[i].mintFee,
                    walletLimit: newStages[i].walletLimit,
                    merkleRoot: newStages[i].merkleRoot,
                    maxStageSupply: newStages[i].maxStageSupply,
                    startTimeUnixSeconds: newStages[i].startTimeUnixSeconds,
                    endTimeUnixSeconds: newStages[i].endTimeUnixSeconds
                })
            );
            emit UpdateStage(
                i,
                newStages[i].price,
                newStages[i].mintFee,
                newStages[i].walletLimit,
                newStages[i].merkleRoot,
                newStages[i].maxStageSupply,
                newStages[i].startTimeUnixSeconds,
                newStages[i].endTimeUnixSeconds
            );
        }
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
     * @dev Returns maximum mintable supply.
     */
    function getMaxMintableSupply() external view override returns (uint256) {
        return _maxMintableSupply;
    }

    /**
     * @dev Sets maximum mintable supply.
     */
    function setMaxMintableSupply(uint256 maxMintableSupply)
        external
        virtual
        onlyOwner
    {
        if (maxMintableSupply > _maxMintableSupply) {
            revert CannotIncreaseMaxMintableSupply();
        }

        _maxMintableSupply = maxMintableSupply;
        emit SetMaxMintableSupply(maxMintableSupply);
    }

    /**
     * @dev Returns global wallet limit. This is the max number of tokens can be minted by one wallet.
     */
    function getGlobalWalletLimit() external view override returns (uint256) {
        return _globalWalletLimit;
    }

    /**
     * @dev Returns number of minted token for a given address.
     */
    function totalMintedByAddress(address a)
        external
        view
        virtual
        override
        returns (uint256)
    {
        return _numberMinted(a);
    }

    /**
     * @dev Returns info for one stage specified by index (starting from 0).
     */
    function getStageInfo(uint256 index)
        external
        view
        override
        returns (
            MintStageInfo memory,
            uint32,
            uint256
        )
    {
        if (index >= _mintStages.length) {
            revert("InvalidStage");
        }
        uint32 walletMinted = _stageMintedCountsPerWallet[index][msg.sender];
        uint256 stageMinted = _stageMintedCounts[index];
        return (_mintStages[index], walletMinted, stageMinted);
    }

    /**
     * @dev Mints token(s).
     *
     * qty - number of tokens to mint
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     * timestamp - the current timestamp
     * signature - the signature from cosigner if using cosigner.
     */
    function mint(
        uint32 qty,
        bytes32[] calldata proof,
        uint64 timestamp,
        bytes calldata signature
    ) external payable virtual canMint hasSupply(qty) nonReentrant {
        uint64 stageTimestamp = uint64(block.timestamp);

        MintStageInfo memory stage;
        if (_cosigner != address(0)) {
            assertValidCosign(msg.sender, qty, timestamp, signature);
            _assertValidTimestamp(timestamp);
            stageTimestamp = timestamp;
        }

        uint256 activeStage = getActiveStageFromTimestamp(stageTimestamp);

        stage = _mintStages[activeStage];

        // Check value
        if (msg.value < stage.price * qty) revert NotEnoughValue();

        // Check stage supply if applicable
        if (stage.maxStageSupply > 0) {
            if (_stageMintedCounts[activeStage] + qty > stage.maxStageSupply)
                revert StageSupplyExceeded();
        }

        // Check global wallet limit if applicable
        if (_globalWalletLimit > 0) {
            if (_numberMinted(msg.sender) + qty > _globalWalletLimit)
                revert WalletGlobalLimitExceeded();
        }

        // Check wallet limit for stage if applicable, limit == 0 means no limit enforced
        if (stage.walletLimit > 0) {
            if (
                _stageMintedCountsPerWallet[activeStage][msg.sender] + qty >
                stage.walletLimit
            ) revert WalletStageLimitExceeded();
        }

        // Check merkle proof if applicable, merkleRoot == 0x00...00 means no proof required
        if (stage.merkleRoot != 0) {
            if (
                MerkleProof.processProof(
                    proof,
                    keccak256(abi.encodePacked(msg.sender))
                ) != stage.merkleRoot
            ) revert InvalidProof();
        }

        _stageMintedCountsPerWallet[activeStage][msg.sender] += qty;
        _stageMintedCounts[activeStage] += qty;
        _safeMint(msg.sender, qty);
    }

    /**
     * @dev Mints token(s) by owner.
     *
     * NOTE: This function bypasses validations thus only available for owner.
     * This is typically used for owner to  pre-mint or mint the remaining of the supply.
     */
    function ownerMint(uint32 qty, address to)
        external
        onlyOwner
        hasSupply(qty)
    {
        _safeMint(to, qty);
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
        _currentBaseURI = baseURI;
        emit SetBaseURI(baseURI);
    }

    /**
     * @dev Returns token URI for a given token id.
     */
    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721A, IERC721A)
        returns (string memory)
    {
        if (!_exists(tokenId)) revert URIQueryForNonexistentToken();

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
    function _getCosignDigest(
        address minter,
        uint32 qty,
        uint64 timestamp
    ) public view returns (bytes32) {
        if (_cosigner == address(0)) revert CosignerNotSet();
        return
            keccak256(
                abi.encodePacked(
                    address(this),
                    minter,
                    qty,
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
        uint32 qty,
        uint64 timestamp,
        bytes memory signature
    ) public view {
        if (
            !SignatureChecker.isValidSignatureNow(
                _cosigner,
                _getCosignDigest(minter, qty, timestamp),
                signature
            )
        ) revert InvalidCosignSignature();
    }

    /**
     * @dev Returns the current active stage based on timestamp.
     */
    function getActiveStageFromTimestamp(uint64 timestamp)
        public
        view
        returns (uint256)
    {
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
        if (timestamp < block.timestamp - _timestampExpirySeconds)
            revert TimestampExpired();
    }

    /**
     * @dev Validates the start timestamp is before end timestamp. Used when updating stages.
     */
    function _assertValidStartAndEndTimestamp(uint64 start, uint64 end)
        internal
        pure
    {
        if (start >= end) revert InvalidStartAndEndTimestamp();
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

    function owner()
        public
        view
        virtual
        override(Ownable, UpdatableOperatorFilterer)
        returns (address)
    {
        return Ownable.owner();
    }

    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public payable override(ERC721A, IERC721A) onlyAllowedOperator(from) {
        super.transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public payable override(ERC721A, IERC721A) onlyAllowedOperator(from) {
        super.safeTransferFrom(from, to, tokenId);
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory data
    ) public payable override(ERC721A, IERC721A) onlyAllowedOperator(from) {
        super.safeTransferFrom(from, to, tokenId, data);
    }
}
