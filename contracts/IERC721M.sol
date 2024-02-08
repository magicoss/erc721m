//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "erc721a/contracts/extensions/IERC721AQueryable.sol";

interface IERC721M is IERC721AQueryable {
    error CannotIncreaseMaxMintableSupply();
    error CannotUpdatePermanentBaseURI();
    error CosignerNotSet();
    error CrossmintAddressNotSet();
    error CrossmintOnly();
    error GlobalWalletLimitOverflow();
    error InsufficientStageTimeGap();
    error InvalidCosignSignature();
    error InvalidProof();
    error InvalidStage();
    error InvalidStageArgsLength();
    error InvalidStartAndEndTimestamp();
    error NoSupplyLeft();
    error NotEnoughValue();
    error NotMintable();
    error Mintable();
    error StageSupplyExceeded();
    error TimestampExpired();
    error TransferFailed();
    error WalletGlobalLimitExceeded();
    error WalletStageLimitExceeded();
    error WithdrawFailed();
    error WrongMintCurrency();

    struct MintStageInfo {
        uint80 price;
        uint80 mintFee;
        uint32 walletLimit; // 0 for unlimited
        bytes32 merkleRoot; // 0x0 for no presale enforced
        uint24 maxStageSupply; // 0 for unlimited
        uint64 startTimeUnixSeconds;
        uint64 endTimeUnixSeconds;
    }

    event UpdateStage(
        uint256 stage,
        uint80 price,
        uint80 mintFee,
        uint32 walletLimit,
        bytes32 merkleRoot,
        uint24 maxStageSupply,
        uint64 startTimeUnixSeconds,
        uint64 endTimeUnixSeconds
    );

    event SetCosigner(address cosigner);
    event SetCrossmintAddress(address crossmintAddress);
    event SetMintable(bool mintable);
    event SetMaxMintableSupply(uint256 maxMintableSupply);
    event SetGlobalWalletLimit(uint256 globalWalletLimit);
    event SetActiveStage(uint256 activeStage);
    event SetBaseURI(string baseURI);
    event SetTimestampExpirySeconds(uint64 expiry);
    event SetMintCurrency(address mintCurrency);
    event PermanentBaseURI(string baseURI);
    event Withdraw(uint256 value);
    event WithdrawERC20(address mintCurrency, uint256 value);

    function getNumberStages() external view returns (uint256);

    function getGlobalWalletLimit() external view returns (uint256);

    function getMaxMintableSupply() external view returns (uint256);

    function totalMintedByAddress(address a) external view returns (uint256);

    function getStageInfo(uint256 index)
        external
        view
        returns (
            MintStageInfo memory,
            uint32,
            uint256
        );
}
