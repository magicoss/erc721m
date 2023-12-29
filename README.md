## ERC721M

ERC721M is a EVM minting protocol that enables the multi stage minting, per stage WL management, per stage supply limit, and crossmint support.

## Motivation

We'd like to introduce the standard of "minting stages". At each stage, the creators can define the following properties:

- per-stage price
- per-stage walletLimit
- per-stage merkleRoot
- per-stage maxStageSupply

The composability of the stages is generic enough to enable flexible and complicated EVM minting contracts.

![](https://bafkreid7sfgi5tycdvbdtobl3mqnwjlrlawdgioaj6vxvtcmmda74doh7q.ipfs.nftstorage.link/)


## Build status
![github ci status](https://github.com/magiceden-oss/erc721m/actions/workflows/ci.yml/badge.svg?branch=main)

![npm](https://img.shields.io/npm/v/@magiceden-oss/erc721m?color=green)


## Tech/framework used

<b>Built with</b>
- [hardhat](https://hardhat.org)
- [ERC721A](https://github.com/chiru-labs/ERC721A), ERC721M is based on the popular ERC721A contract.

## Features

- Minting Stages
- Permenent BaseURI Support
- Non-incresing Max Total Supply Support
- Per-stage WL Merkle Tree
- Per-stage Max Supply
- Global and Per-stage Limit
- Native TypeScript and Typechain-Types Support

## Contracts
| Contract                | Description                                                                           |
|-------------------------|---------------------------------------------------------------------------------------|
| ERC721M                 | The basic minting contract                                                            |
| ERC721MLite             | The lite version of ERC721M                                                           |
| ERC721MOperatorFilterer | ERC721M with OpenSea Operator Filterer                                                |
| ERC721MOnft             | ERC721M with LayerZero bridging. The contract is on beta. Use at your own risk.       |
| BucketAuction           | Bucket auction style minting contract. The contract is on beta. Use at your own risk. |
| DutchAuction            | Dutch auction style minting contract. The contract is on beta. Use at your own risk.  |

## Installation
Provide step by step series of examples and explanations about how to get a development env running.


```bash
npm add @magiceden-oss/erc721m
```

## Code Example

```typescript
import { ERC721M, ERC721M__factory } from '@magiceden-oss/erc721m';

const contract = ERC721M__factory.connect(
  contractAddress,
  signerOrProvider,
);
```

## API Reference

```bash
# Compile the contract
npm run build

# Get the auto generated typechain-types
./typechain-types
```

## Tests

```bash
npm run test
```

We are targeting 100% lines coverage.

![](https://bafkreic3dyzp5i2fi7co2fekkbgmyxgv342irjy5zfiuhvjqic6fuu53ju.ipfs.nftstorage.link/)

## Security
- [ERC721M Kudelski Security Audit](./docs/AUDIT-PUBLIC-RELEASE-MagicEden-ERC721M1.pdf)
### Bounty Program
 - HackerOne program: please contact https://magiceden.io/.well-known/security.txt
 - Please be noted that there are some prerequites need to be met and certain assumptions are made when using the contracts. Please check the [Contract Usage Guide](./docs/ContractUsageGuide.md) for more details.

## Used By

- [Magic Eden Launchpad](https://magiceden.io/launchpad/about)

## License

MIT © [MagicEden Open Source](https://github.com/magiceden-oss)
