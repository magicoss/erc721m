// This module wraps up the constants which can be used by any script

export const ContractDetails = {
  ERC721CM: { name: 'ERC721CM' }, // ERC721M on ERC721C v2
  ERC721CMBasicRoyalties: { name: 'ERC721CMBasicRoyalties' }, // ERC721M on ERC721C v2 with basic royalties
  ERC721CMRoyalties: { name: 'ERC721CMRoyalties' }, // ERC721M on ERC721C v2 with updatable royalties
  ERC721CMRoyaltiesInitializable: { name: 'ERC721CMRoyaltiesInitializable' }, // ERC721M on ERC721C v2 with updatable royalties and compatible with EIP-1167 clone
  ERC721M: { name: 'ERC721M' }, // The contract of direct sales
  ERC721MOperatorFilterer: { name: 'ERC721MOperatorFilterer' }, // ERC721M with operator filterer
  ERC721CMRoyaltiesCloneFactory: { name: 'ERC721CMRoyaltiesCloneFactory' }, // ERC721CMRoyaltiesCloneFactory
  BucketAuction: { name: 'BucketAuction' }, // The contract of bucket auctions
  ERC1155M: { name: 'ERC1155M' }, // ERC1155M
} as const;

export const ERC721BatchTransferContract =
  '0x38F7ba911f7efc434D29D6E39c814E9d4De3FEef';

export const ERC721CV2_VALIDATOR = '0x721C00182a990771244d7A71B9FA2ea789A3b433';
export const ERC721CV2_FREEZE_LEVEL = 4;
export const ERC721CV2_EMPTY_LIST = 4;

// Mainnet, Polygon, Base
export const ERC721CMRoyaltiesCloneFactoryContract = '0x7cEEd7215D71393d56966dA48C5727851326e101';