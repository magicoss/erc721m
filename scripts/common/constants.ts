// This module wraps up the constants which can be used by any script

export const ContractDetails = {
  ERC721M: { name: 'ERC721M' }, // The contract of direct sales
  BucketAuction: { name: 'BucketAuction' }, // The contract of bucket auctions
  ERC721MIncreasableSupply: { name: 'ERC721MIncreasableSupply' }, // ERC721M with increasable supply
  ERC721MOperatorFilterer: { name: 'ERC721MOperatorFilterer' }, // ERC721M with operator filterer
  ERC721MIncreasableOperatorFilterer: { name: 'ERC721MIncreasableOperatorFilterer' }, // ERC721M with increasable supply and operator filterer
} as const;
