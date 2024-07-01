//SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./utils/Constants.sol";

import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./IERC1155M.sol";

/**
 * @title ERC1155M
 *
 * @dev OpenZeppelin's ERC1155 subclass with MagicEden launchpad features including
 *  - multi token minting
 *  - multi minting stages with time-based auto stage switch
 *  - global and stage wallet-level minting limit
 *  - whitelist
 *  - variable wallet limit
 */
contract ERC1155M is IERC1155M, ERC1155Supply, ERC2981, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // Collection name.
    string public name;

    // Collection symbol.
    string public symbol;

    // The total mintable supply per token.
    uint256[] private _maxMintableSupply;

    // Global wallet limit, across all stages, per token.
    uint256[] private _globalWalletLimit;

    // Number of tokens.
    uint256 private _numTokens;

    // Mint stage infomation. See MintStageInfo for details.
    MintStageInfo[] private _mintStages;

    // Whether the token can be transferred.
    bool private _transferable;

    // Minted count per stage per token per wallet
    mapping(uint256 => mapping(uint256 => mapping(address => uint32)))
        private _stageMintedCountsPerTokenPerWallet;

    // Minted count per stage per token.
    mapping(uint256 => mapping(uint256 => uint256)) private _stageMintedCountsPerToken;

    // Address of ERC-20 token used to pay for minting. If 0 address, use native currency.
    address private _mintCurrency;

    // Total mint fee
    uint256 private _totalMintFee;

    // Fund receiver
    address public immutable FUND_RECEIVER;

    constructor(
        string memory collectionName,
        string memory collectionSymbol,
        string memory uri,
        uint256[] memory maxMintableSupply,
        uint256[] memory globalWalletLimit,
        address mintCurrency,
        address fundReceiver,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator
    ) Ownable(msg.sender) ERC1155(uri) {
        if (maxMintableSupply.length != globalWalletLimit.length) {
            revert InvalidLimitArgsLength();
        }

        for (uint256 i = 0; i < globalWalletLimit.length; i++) {
            if (globalWalletLimit[i] > maxMintableSupply[i]) {
                revert GlobalWalletLimitOverflow();
            }
        }

        name = collectionName;
        symbol = collectionSymbol;
        _numTokens = globalWalletLimit.length;
        _maxMintableSupply = maxMintableSupply;
        _globalWalletLimit = globalWalletLimit;
        _mintCurrency = mintCurrency;
        _transferable = true;
        FUND_RECEIVER = fundReceiver;

        _setDefaultRoyalty(royaltyReceiver, royaltyFeeNumerator);
    }

    /**
     * @dev Returns whether it has enough supply for the given qty.
     */
    modifier hasSupply(uint256 tokenId, uint256 qty) {
        if (_maxMintableSupply[tokenId] > 0 && totalSupply(tokenId) + qty > _maxMintableSupply[tokenId]) revert NoSupplyLeft();
        _;
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
        delete _mintStages;

        for (uint256 i = 0; i < newStages.length; i++) {
            if (i >= 1) {
                if (
                    newStages[i].startTimeUnixSeconds <
                    newStages[i - 1].endTimeUnixSeconds +
                        TIMESTAMP_EXPIRY_SECONDS
                ) {
                    revert InsufficientStageTimeGap();
                }
            }
            _assertValidStartAndEndTimestamp(
                newStages[i].startTimeUnixSeconds,
                newStages[i].endTimeUnixSeconds
            );
            _assertValidStageArgsLength(newStages[i]);

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
     * @dev Returns maximum mintable supply per token.
     */
    function getMaxMintableSupply(uint256 tokenId) external view override returns (uint256) {
        return _maxMintableSupply[tokenId];
    }

    /**
     * @dev Sets maximum mintable supply.
     *
     * New supply cannot be larger than the old.
     */
    function setMaxMintableSupply(
        uint256 tokenId,
        uint256 maxMintableSupply
    ) external virtual onlyOwner {
        if (maxMintableSupply > _maxMintableSupply[tokenId]) {
            revert CannotIncreaseMaxMintableSupply();
        }
        _maxMintableSupply[tokenId] = maxMintableSupply;
        emit SetMaxMintableSupply(tokenId, maxMintableSupply);
    }

    /**
     * @dev Returns global wallet limit. This is the max number of tokens can be minted by one wallet.
     */
    function getGlobalWalletLimit(uint256 tokenId) external view override returns (uint256) {
        return _globalWalletLimit[tokenId];
    }

    /**
     * @dev Sets global wallet limit.
     */
    function setGlobalWalletLimit(
        uint256 tokenId,
        uint256 globalWalletLimit
    ) external onlyOwner {
        if (globalWalletLimit > _maxMintableSupply[tokenId]) {
            revert GlobalWalletLimitOverflow();
        }
        _globalWalletLimit[tokenId] = globalWalletLimit;
        emit SetGlobalWalletLimit(tokenId, globalWalletLimit);
    }

     /**
     * @dev Returns number of minted tokens for a given address.
     */
    function totalMintedByAddress(
        address account
    ) public view virtual override returns (uint256[] memory) {
        uint256[] memory totalMinted = new uint256[](_numTokens);
        for (uint256 token = 0; token < _numTokens; token++ ) {
            for (uint256 stage = 0; stage < _mintStages.length; stage++) {
                totalMinted[token] += _stageMintedCountsPerTokenPerWallet[stage][token][account];
            }
        }
        return totalMinted;
    }

    /**
     * @dev Returns number of minted token for a given token and address.
     */
    function totalMintedByTokenByAddress(
        address account,
        uint256 tokenId
    ) internal view virtual returns (uint256) {
        uint256 totalMinted = 0;
        for (uint256 i = 0; i < _mintStages.length; i++) {
            totalMinted += _stageMintedCountsPerTokenPerWallet[i][tokenId][account];
        }
        return totalMinted;
    }

    /**
     * @dev Returns number of minted tokens for a given stage and address.
     */
    function totalMintedByStageByAddress(
        uint256 stage,
        address account
    ) internal view virtual returns (uint256[] memory) {
        uint256[] memory totalMinted = new uint256[](_numTokens);
        for (uint256 token = 0; token < _numTokens; token++ ) {
            totalMinted[token] += _stageMintedCountsPerTokenPerWallet[stage][token][account];
        }
        return totalMinted;
    }

   /**
     * @dev Returns number of stages.
     */
    function getNumberStages() external view override returns (uint256) {
        return _mintStages.length;
    }

    /**
     * @dev Returns info for one stage specified by stage index (starting from 0).
     */
    function getStageInfo(
        uint256 stage
    ) external view override returns (MintStageInfo memory, uint256[] memory, uint256[] memory) {
        if (stage >= _mintStages.length) {
            revert InvalidStage();
        }
        uint256[] memory walletMinted = totalMintedByAddress(msg.sender);
        uint256[] memory stageMinted = totalMintedByStageByAddress(stage, msg.sender);
        return (_mintStages[stage], walletMinted, stageMinted);
    }

    /**
     * @dev Returns mint currency address.
     */
    function getMintCurrency() external view returns (address) {
        return _mintCurrency;
    }

    /**
     * @dev Mints token(s).
     *
     * tokenId - token id 
     * qty - number of tokens to mint
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     */
    function mint(
        uint256 tokenId,
        uint32 qty,
        bytes32[] calldata proof
    ) external payable virtual nonReentrant {
        _mintInternal(msg.sender, tokenId, qty, 0, proof);
    }

    /**
     * @dev Mints token(s) with limit.
     *
     * tokenId - token id 
     * qty - number of tokens to mint
     * limit - limit for the given minter
     * proof - the merkle proof generated on client side. This applies if using whitelist.
     */
    function mintWithLimit(
        uint256 tokenId,
        uint32 qty,
        uint32 limit,
        bytes32[] calldata proof
    ) external payable virtual nonReentrant {
        _mintInternal(msg.sender, tokenId, qty, limit, proof);
    }

    /**
     * @dev Implementation of minting.
     */
    function _mintInternal(
        address to,
        uint256 tokenId,
        uint32 qty,
        uint32 limit,
        bytes32[] calldata proof
    ) internal hasSupply(tokenId, qty) {
        uint64 stageTimestamp = uint64(block.timestamp);
        uint256 activeStage = getActiveStageFromTimestamp(stageTimestamp);

        MintStageInfo memory stage = _mintStages[activeStage];

        // Check value if minting with ETH
        if (
            _mintCurrency == address(0) &&
            msg.value < (stage.price[tokenId] + stage.mintFee[tokenId]) * qty
        ) revert NotEnoughValue();

        // Check stage supply if applicable
        if (stage.maxStageSupply[tokenId] > 0) {
            if (_stageMintedCountsPerToken[activeStage][tokenId] + qty > stage.maxStageSupply[tokenId])
                revert StageSupplyExceeded();
        }

        // Check global wallet limit if applicable
        if (_globalWalletLimit[tokenId] > 0) {
            if (totalMintedByTokenByAddress(to, tokenId) + qty > _globalWalletLimit[tokenId])
                revert WalletGlobalLimitExceeded();
        }

        // Check wallet limit for stage if applicable, limit == 0 means no limit enforced
        if (stage.walletLimit[tokenId] > 0) {
            if (
                _stageMintedCountsPerTokenPerWallet[activeStage][tokenId][to] + qty >
                stage.walletLimit[tokenId]
            ) revert WalletStageLimitExceeded();
        }

        // Check merkle proof if applicable, merkleRoot == 0x00...00 means no proof required
        if (stage.merkleRoot[tokenId] != 0) {
            if (
                MerkleProof.processProof(
                    proof,
                    keccak256(abi.encodePacked(to, limit))
                ) != stage.merkleRoot[tokenId]
            ) revert InvalidProof();

            // Verify merkle proof mint limit
            if (
                limit > 0 &&
                _stageMintedCountsPerTokenPerWallet[activeStage][tokenId][to] + qty > limit
            ) {
                revert WalletStageLimitExceeded();
            }
        }

        if (_mintCurrency != address(0)) {
            // ERC20 mint payment
            IERC20(_mintCurrency).safeTransferFrom(
                msg.sender,
                address(this),
                (stage.price[tokenId] + stage.mintFee[tokenId]) * qty
            );
        }

        _totalMintFee += stage.mintFee[tokenId] * qty;

        _stageMintedCountsPerTokenPerWallet[activeStage][tokenId][to] += qty;
        _stageMintedCountsPerToken[activeStage][tokenId] += qty;
        _mint(to, tokenId, qty, "");
    }

    /**
     * @dev Mints token(s) by owner.
     *
     * NOTE: This function bypasses validations thus only available for owner.
     * This is typically used for owner to  pre-mint or mint the remaining of the supply.
     */
    function ownerMint(
        address to,
        uint256 tokenId,
        uint32 qty
    ) external onlyOwner hasSupply(tokenId, qty) {
        _mint(to, tokenId, qty, "");
    }

    /**
     * @dev Withdraws funds by owner.
     */
    function withdraw() external onlyOwner {
        (bool success, ) = MINT_FEE_RECEIVER.call{value: _totalMintFee}("");
        if (!success) revert TransferFailed();

        uint256 remainingValue = address(this).balance;
        (success, ) = FUND_RECEIVER.call{value: remainingValue}("");
        if (!success) revert WithdrawFailed();

        emit Withdraw(_totalMintFee + remainingValue);
    }

    /**
     * @dev Withdraws ERC-20 funds by owner.
     */
    function withdrawERC20() external onlyOwner {
        if (_mintCurrency == address(0)) revert WrongMintCurrency();

        IERC20(_mintCurrency).safeTransfer(MINT_FEE_RECEIVER, _totalMintFee);

        uint256 remaining = IERC20(_mintCurrency).balanceOf(address(this));
        IERC20(_mintCurrency).safeTransfer(FUND_RECEIVER, remaining);

        emit WithdrawERC20(_mintCurrency, _totalMintFee + remaining);
    }

    /**
     * @dev Sets a new URI for all token types. The URI relys on token type ID
     * substitution mechanism.
     */
    function setURI(string calldata newURI) external onlyOwner {
        _setURI(newURI);
    }

    /**
     * @dev Sets transferable of the tokens.
     */
    function setTransferable(bool transferable) external onlyOwner {
        _transferable = transferable;
        emit SetTransferable(transferable);
    }

    /**
     * @dev Returns the current active stage based on timestamp.
     */
    function getActiveStageFromTimestamp(
        uint64 timestamp
    ) public view returns (uint256) {
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
     * @dev Set default royalty for all tokens
     */
    function setDefaultRoyalty(
        address receiver,
        uint96 feeNumerator
    ) public onlyOwner {
        super._setDefaultRoyalty(receiver, feeNumerator);
        emit DefaultRoyaltySet(receiver, feeNumerator);
    }

    /**
     * @dev Set default royalty for individual token
     */
    function setTokenRoyalty(
        uint256 tokenId,
        address receiver,
        uint96 feeNumerator
    ) public onlyOwner {
        super._setTokenRoyalty(tokenId, receiver, feeNumerator);
        emit TokenRoyaltySet(tokenId, receiver, feeNumerator);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override(ERC2981, ERC1155) returns (bool) {
        return
            ERC1155.supportsInterface(interfaceId) ||
            ERC2981.supportsInterface(interfaceId);
    }

    /**
     * @dev The hook of token transfer to validate the transfer.
     */
    function _update(
        address from,
        address to,
        uint256[] memory ids,
        uint256[] memory values
    ) internal virtual override {
        super._update(from, to, ids, values);

        bool fromZeroAddress = from == address(0);
        bool toZeroAddress = to == address(0);

        if (!fromZeroAddress && !toZeroAddress && !_transferable) {
            revert NotTransferable();
        }
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

    function _assertValidStageArgsLength(MintStageInfo calldata stageInfo) internal {
        if (stageInfo.price.length != _numTokens ||
        stageInfo.mintFee.length != _numTokens ||
        stageInfo.walletLimit.length != _numTokens ||
        stageInfo.merkleRoot.length != _numTokens ||
        stageInfo.maxStageSupply.length != _numTokens
        ) {
            revert InvalidStageArgsLength();
        }
    }
}
