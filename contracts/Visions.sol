//SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ERC721A, ERC721CM, IERC721A, ERC721ACQueryable} from "./ERC721CM.sol";
import {UpdatableRoyalties} from "./royalties/UpdatableRoyalties.sol";

/**
 * @title SFT Visions smart contract
 * @dev Vanilla ERC721CM with a few tweaks
 * - ✅ no global wallet limit (through init when deploying script)
 * - ✅ operator airdrop methods (for GP airdrop, treasury, etc.)
 * - ✅ trades are locked for 3 days for first 2000 tokens
 * - ✅ all trades are locked until collection is minted out
 * - ✅ ERC2981 royalties
 */
contract Visions is ERC721CM, UpdatableRoyalties {
    /* 
    All tokens whose id is less than this value (or equal) are transfer locked for 3 days (transferLockTimestamp).
    All tokens whose id is more than this value are not locked from immediate transfers.
    */
    uint16 private _transferLockMaxId = 2000;
    uint64 private _transferLockTimestamp = 0;
    // when set to true, it will bypass "transfer locked until minted out"
    bool private _transferLockOverride = false;
    address private _sftOperator;
    error NotEnoughGenesisPasses();
    error TransferLockedForNow();
    error TransferLockedUntilMintedOut();

    constructor(
        string memory collectionName,
        string memory collectionSymbol,
        string memory tokenURISuffix,
        uint256 globalWalletLimit,
        address cosigner,
        uint64 timestampExpirySeconds,
        address mintCurrency,
        address royaltyReceiver,
        uint96 royaltyFeeNumerator,
        uint64 transferLockTimestamp,
        address sftOperator
    )
        ERC721CM(
            collectionName,
            collectionSymbol,
            tokenURISuffix,
            8000,
            globalWalletLimit,
            cosigner,
            timestampExpirySeconds,
            mintCurrency
        )
        UpdatableRoyalties(royaltyReceiver, royaltyFeeNumerator)
    {
        _transferLockTimestamp = transferLockTimestamp;
        _sftOperator = sftOperator;
    }

    /**
     * @dev Returns the token id to start from (1).
     */
    function _startTokenId() internal view virtual override returns (uint256) {
        return 1;
    }

    /**
     * @dev Returns the total number of tokens minted.
     */
    function totalMinted() public view returns (uint256) {
        return _totalMinted();
    }

    /**
     * @dev Transfers are locked for a pre-determined window for earlier stages.
     * @param from - the address to transfer from
     * @param to - the address to transfer to
     * @param tokenId - the id of the token to transfer
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public payable virtual override(ERC721A, IERC721A) {
        // transfer locked until minted out or manual override
        if (
            !_transferLockOverride &&
            totalMinted() < this.getMaxMintableSupply()
        ) {
            revert TransferLockedUntilMintedOut();
        }

        // tokens minted in earlier phases are locked for a specific time
        if (
            tokenId <= _transferLockMaxId &&
            block.timestamp < _transferLockTimestamp
        ) {
            revert TransferLockedForNow();
        }

        super.transferFrom(from, to, tokenId);
    }

    // ERC2981 Royalty START
    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        virtual
        override(ERC2981, ERC721ACQueryable, IERC721A)
        returns (bool)
    {
        return
            ERC721ACQueryable.supportsInterface(interfaceId) ||
            ERC2981.supportsInterface(interfaceId);
    }
    // ERC2981 Royalty END

    // SFT operator START
    modifier onlySftOperator() {
        require(
            msg.sender == _sftOperator,
            "Visions: caller is not the SFT operator"
        );
        _;
    }
    modifier onlyOwnerOrSftOperator() {
        require(
            msg.sender == owner() || msg.sender == _sftOperator,
            "Visions: caller is not the owner or SFT operator"
        );
        _;
    }

    /**
     * @dev Updates the transfer lock variables (max id and timestamp).
     * @param newTransferLockMaxId The maximum token id to lock transfers for.
     * @param timestamp The timestamp to lock transfers until.
     */
    function updateTransferLock(
        uint16 newTransferLockMaxId,
        uint64 timestamp
    ) external onlySftOperator {
        _transferLockMaxId = newTransferLockMaxId;
        _transferLockTimestamp = timestamp;
    }

    /**
     * @dev Enables or disables "transfer lock until minted out".
     * @param transferLockOverride The new value for the transfer lock override.
     */
    function setTransferLockOverride(
        bool transferLockOverride
    ) external onlySftOperator {
        _transferLockOverride = transferLockOverride;
    }

    /**
     * @dev Mints token(s) by owner.
     * This is the first phase, where we airdrop an NFT for each owner of a GP.
     * The owners parameter values will come from a snapshot.
     * @param owners - the addresses to mint for
     */
    function airdropForGenesisPassHolders(
        address[] calldata owners
    ) external onlySftOperator {
        // for each id we mint a PFP for the owner
        // we cannot batch mint to respect the id mapping (GP id 1 => PFP id 1, etc.)
        for (uint16 i = 0; i < owners.length; i++) {
            // minting the token
            _safeMint(owners[i], 1);
        }
    }

    /**
     * @dev Mints token(s) by owner.
     *
     * NOTE: This function bypasses validations thus only available for owner.
     * This is typically used for owner to  pre-mint or mint the remaining of the supply.
     */
    function operatorMint(
        uint32 qty,
        address to
    ) external onlySftOperator hasSupply(qty) {
        _safeMint(to, qty);
    }

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(
        address newOwner
    ) public virtual override onlyOwnerOrSftOperator {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    function disableSftOperator() external onlySftOperator {
        _sftOperator = address(0);
    }
    // SFT operator END
}