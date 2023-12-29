//SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface IERC1155M {
    error CannotIncreaseMaxMintableSupplies();
    error CannotUpdatePermanentBaseURI();
    error CosignerNotSet();
    error CrossmintAddressNotSet();
    error CrossmintOnly();
    error GlobalWalletLimitOverflow();
    error InsufficientStageTimeGap();
    error InvalidCosignSignature();
    error InvalidInputLength();
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
    error URIQueryForNonexistentToken();
    error WalletGlobalLimitExceeded();
    error WalletStageLimitExceeded();
    error WithdrawFailed();

    struct MintStageInfo {
        uint80[] prices; // in wei
        uint32[] walletLimits; // 0 for unlimited
        bytes32[] merkleRoots; // 0x0 for no presale enforced
        uint24[] maxStageSupplies; // 0 for unlimited
        uint64 startTimeUnixSeconds;
        uint64 endTimeUnixSeconds;
    }

    event UpdateStage(
        uint256 stage,
        uint80[] prices,
        uint32[] walletLimits,
        bytes32[] merkleRoots,
        uint24[] maxStageSupplies,
        uint64 startTimeUnixSeconds,
        uint64 endTimeUnixSeconds
    );

    event SetCosigner(address cosigner);
    event SetCrossmintAddress(address crossmintAddress);
    event SetMintable(bool mintable);
    event SetMaxMintableSupplies(uint256[] maxMintableSupplies);
    event SetGlobalWalletLimits(uint256[] globalWalletLimits);
    event SetActiveStage(uint256 activeStage);
    event SetBaseURI(string baseURI);
    event SetTimestampExpirySeconds(uint64 expiry);
    event PermanentBaseURI(string baseURI);
    event Withdraw(uint256 value);

    function getCosigner() external view returns (address);

    function getCrossmintAddress() external view returns (address);

    function getNumberStages() external view returns (uint256);

    function getGlobalWalletLimits() external view returns (uint256[] memory);

    function getTimestampExpirySeconds() external view returns (uint64);

    function getMaxMintableSupplies() external view returns (uint256[] memory);

    function getMintable() external view returns (bool);

    function totalMintedByAddress(
        address a
    ) external view returns (uint256[] memory);

    function getTokenURISuffix() external view returns (string memory);

    function getStageInfo(
        uint256 index
    )
        external
        view
        returns (MintStageInfo memory, uint32[] memory, uint256[] memory);

    function getActiveStageFromTimestamp(
        uint64 timestamp
    ) external view returns (uint256);

    function assertValidCosign(
        address minter,
        uint32[] calldata tokenIds,
        uint32[] calldata amounts,
        uint64 timestamp,
        bytes memory signature
    ) external view;
}
