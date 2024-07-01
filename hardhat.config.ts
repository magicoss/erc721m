import 'dotenv/config';

import "@nomicfoundation/hardhat-verify";
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-contract-sizer';
import 'hardhat-gas-reporter';
import 'hardhat-watcher';
import { HardhatUserConfig, task, types } from 'hardhat/config';
import 'solidity-coverage';
import {
  setStages,
  set1155Stages,
  setMintable,
  deploy,
  deploy1155,
  deployClone,
  setBaseURI,
  setCrossmintAddress,
  mint,
  ownerMint,
  setGlobalWalletLimit,
  setMaxMintableSupply,
  deployBA,
  setTimestampExpirySeconds,
  transferOwnership,
  setStartAndEndTimeUnixSeconds,
  setMinContributionInWei,
  sendRefund,
  sendRefundBatch,
  sendTokensAndRefund,
  sendTokensAndRefundBatch,
  getMinContributionInWei,
  getStartTimeBA,
  getEndTimeBA,
  getPrice,
  setPrice,
  deployOwnedRegistrant,
  getContractCodehash,
  deploy721BatchTransfer,
  send721Batch,
  freezeTrading,
  thawTrading,
  cleanWhitelist,
} from './scripts';
import { deployCloneFactory } from './scripts/deployCloneFactory';

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: {
      viaIR: true,
      optimizer: {
        enabled: true,
        runs: 20,
        details: {
          yulDetails: {
            optimizerSteps: "dhfoD[xarrscLMcCTU]uljmul",
          },
        },
      },
    },
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
    strict: true,
  },
  paths: {
    artifacts: './artifacts',
    cache: './cache',
    sources: './contracts',
    tests: './test',
  },
  networks: {
    hardhat: {
      accounts: {
        accountsBalance: '1000000000000000000000'
      }
    },
    base: {
      url: process.env.BASE_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    goerli: {
      url:
        process.env.GOERLI_URL || 'https://eth-goerli.api.onfinality.io/public',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_URL || 'https://rpc.sepolia.org',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.MAINNET_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mumbai: {
      url: process.env.MUMBAI_URL || 'https://rpc-mumbai.maticvigil.com/',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    polygon: {
      url: process.env.POLYGON_URL || '',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    fuji: {
      url: process.env.FUJI_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
      accounts:
        process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: 'USD',
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: true
  }
};

task('setStages', 'Set stages for ERC721M')
  .addParam('contract', 'contract address')
  .addParam('stages', 'stages json file')
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam(
    'gaslimit',
    'Set maximum gas units to spend on transaction',
    500000,
    types.int,
  )
  .setAction(setStages);


task('set1155Stages', 'Set stages for ERC721M')
  .addParam('contract', 'contract address')
  .addParam('stages', 'stages json file')
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam(
    'gaslimit',
    'Set maximum gas units to spend on transaction',
    500000,
    types.int,
  )
  .setAction(set1155Stages);

task('setMintable', 'Set mintable state for ERC721M')
  .addParam('contract', 'contract address')
  .addParam('mintable', 'mintable state', 'true', types.boolean)
  .setAction(setMintable);

task('deploy', 'Deploy ERC721M')
  .addParam('name', 'name')
  .addParam('symbol', 'symbol')
  .addParam('maxsupply', 'max supply')
  .addParam('tokenurisuffix', 'token uri suffix', '.json')
  .addParam('globalwalletlimit', 'global wallet limit', '0')
  .addParam('timestampexpiryseconds', 'timestamp expiry in seconds', '300')
  .addOptionalParam(
    'cosigner',
    'cosigner address (0x00...000 if not using cosign)',
    '0x0000000000000000000000000000000000000000',
  )
  .addOptionalParam(
    'mintcurrency',
    'ERC-20 contract address (if minting with ERC-20)',
    '0x0000000000000000000000000000000000000000',
  )
  .addOptionalParam(
    'fundreceiver',
    'The treasury wallet to receive mint fund',
  )
  .addParam<boolean>(
    'useoperatorfilterer',
    'whether or not to use operator filterer, used with legacy 721M contract',
    false,
    types.boolean,
  )
  .addParam<boolean>(
    'openedition',
    'whether or not a open edition mint (unlimited supply, 999,999,999)',
    false,
    types.boolean,
  )
  .addOptionalParam<boolean>(
    'useerc721c',
    'whether or not to use ERC721C',
    true,
    types.boolean,
  )
  .addOptionalParam<boolean>(
    'useerc2198',
    'whether or not to use ERC2198',
    true,
    types.boolean,
  )
  .addOptionalParam(
    'erc2198royaltyreceiver',
    'erc2198 royalty receiver address',
  )
  .addOptionalParam(
    'erc2198royaltyfeenumerator',
    'erc2198 royalty fee numerator',
  )
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam('gaslimit', 'Set maximum gas units to spend on transaction')
  .setAction(async (tasksArgs, hre) => {
    console.log('Cleaning...');
    await hre.run('clean');
    console.log('Compiling...');
    await hre.run('compile');
    console.log('Deploying...');
    await deploy(tasksArgs, hre);
  });


task('deploy1155', 'Deploy ERC1155M')
  .addParam('name', 'name')
  .addParam('symbol', 'symbol')
  .addParam('uri', 'token uri')
  .addParam('maxsupply', 'max supply')
  .addParam('globalwalletlimit', 'global wallet limit')
  .addOptionalParam(
    'mintcurrency',
    'ERC-20 contract address (if minting with ERC-20)',
    '0x0000000000000000000000000000000000000000',
  )
  .addOptionalParam(
    'fundreceiver',
    'The treasury wallet to receive mint fund',
  )
  .addParam<boolean>(
    'openedition',
    'whether or not a open edition mint (unlimited supply, 999,999,999)',
    false,
    types.boolean,
  )
  .addOptionalParam(
    'erc2198royaltyreceiver',
    'erc2198 royalty receiver address',
  )
  .addOptionalParam(
    'erc2198royaltyfeenumerator',
    'erc2198 royalty fee numerator',
  )
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam('gaslimit', 'Set maximum gas units to spend on transaction')
  .setAction(async (tasksArgs, hre) => {
    // console.log('Cleaning...');
    // await hre.run('clean');
    // console.log('Compiling...');
    // await hre.run('compile');
    console.log('Deploying...');
    await deploy1155(tasksArgs, hre);
});

task('setBaseURI', 'Set the base uri')
  .addParam('uri', 'uri')
  .addParam('contract', 'contract address')
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam(
    'gaslimit',
    'Set maximum gas units to spend on transaction',
    500000,
    types.int,
  )
  .setAction(setBaseURI);

task('setCrossmintAddress', 'Set crossmint address')
  .addParam('contract', 'contract address')
  .addParam('crossmintaddress', 'new crossmint address')
  .setAction(setCrossmintAddress);

task('mint', 'Mint token(s)')
  .addParam('contract', 'contract address')
  .addParam('qty', 'quantity to mint', '1')
  .addParam('minttime', 'time of the mint')
  .setAction(mint);

task('ownerMint', 'Mint token(s) as owner')
  .addParam('contract', 'contract address')
  .addParam('qty', 'quantity to mint', '1')
  .addOptionalParam('to', 'recipient address')
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam('gaslimit', 'Set maximum gas units to spend on transaction')
  .setAction(ownerMint);

task('setGlobalWalletLimit', 'Set the global wallet limit')
  .addParam('contract', 'contract address')
  .addParam('limit', 'global wallet limit (0 for no global limit)')
  .setAction(setGlobalWalletLimit);

task('setMaxMintableSupply', 'set max mintable supply')
  .addParam('contract', 'contract address')
  .addParam('supply', 'new supply')
  .setAction(setMaxMintableSupply);

task('deployBA', 'Deploy BucketAuction')
  .addParam('name', 'name')
  .addParam('symbol', 'symbol')
  .addParam('maxsupply', 'max supply')
  .addParam('tokenurisuffix', 'token uri suffix', '.json')
  .addParam('globalwalletlimit', 'global wallet limit')
  .addOptionalParam(
    'cosigner',
    'cosigner address (0x00...000 if not using cosign)',
    '0x0000000000000000000000000000000000000000',
  )
  .addParam(
    'mincontributioninwei',
    'The minimum contribution in wei required only for the AuctionBucket',
  )
  .addParam('auctionstarttime', 'The start time of the bucket auction')
  .addParam('auctionendtime', 'The end time of the bucket auction')
  .setAction(deployBA);

task('setTimestampExpirySeconds', 'Set the timestamp expiry seconds')
  .addParam('contract', 'contract address')
  .addParam('timestampexpiryseconds', 'timestamp expiry in seconds')
  .setAction(setTimestampExpirySeconds);

task('transferOwnership', 'transfer contract ownership')
  .addParam('contract', 'contract address')
  .addParam('owner', 'new owner address')
  .setAction(transferOwnership);

task(
  'setStartAndEndTimeUnixSeconds',
  'set the start and end time for bucket auction',
)
  .addParam('contract', 'contract address')
  .addParam('starttime', 'start time of the bucket auction')
  .addParam('endtime', 'end time of the bucket auction')
  .setAction(setStartAndEndTimeUnixSeconds);

task('setMinContributionInWei', 'set the min contribution in wei for BA')
  .addParam('contract', 'contract address')
  .addParam('mincontributioninwei', 'min contribution in wei')
  .setAction(setMinContributionInWei);

task('sendRefund', 'send refund to the specified address for BA')
  .addParam('contract', 'contract address')
  .addParam('to', 'address to refund')
  .setAction(sendRefund);

task('sendRefundBatch', 'send refund to the specified addresses for BA')
  .addParam('contract', 'contract address')
  .addParam(
    'addresses',
    'path to the json file with an array of addresses to refund',
  )
  .setAction(sendRefundBatch);

task(
  'sendTokensAndRefund',
  'send tokens and refund the remaining to the specified address for BA',
)
  .addParam('contract', 'contract address')
  .addParam('to', 'address to refund')
  .setAction(sendTokensAndRefund);

task(
  'sendTokensAndRefundBatch',
  'send tokens and refund to the specified addresses for BA',
)
  .addParam('contract', 'contract address')
  .addParam(
    'addresses',
    'path to the json file with an array of addresses to refund',
  )
  .setAction(sendTokensAndRefundBatch);

task('getMinContributionInWei', 'get the min contribution in wei for BA')
  .addParam('contract', 'contract address')
  .setAction(getMinContributionInWei);

task('getStartTimeBA', 'get the start time of BA')
  .addParam('contract', 'contract address')
  .setAction(getStartTimeBA);

task('getEndTimeBA', 'get the end time of BA')
  .addParam('contract', 'contract address')
  .setAction(getEndTimeBA);

task('getPrice', 'get the price set for BA')
  .addParam('contract', 'contract address')
  .setAction(getPrice);

task('setPrice', 'set the price set for BA')
  .addParam('contract', 'contract address')
  .addParam('priceinwei', 'price in wei')
  .setAction(setPrice);

task('deployOwnedRegistrant', 'Deploy OwnedRegistrant')
  .addParam(
    'newowner',
    'new owner address',
    '0x0000000000000000000000000000000000000000',
  )
  .setAction(deployOwnedRegistrant);

task('getContractCodehash', 'Get the code hash of a contract')
  .addParam('contract', 'contract address')
  .setAction(getContractCodehash);

task('deploy721BatchTransfer', 'Deploy ERC721BatchTransfer').setAction(
  deploy721BatchTransfer,
);

task('send721Batch', 'Send ERC721 tokens in batch')
  .addParam('contract', 'contract address')
  .addOptionalParam(
    'transferfile',
    'path to the file with the transfer details',
  )
  .addOptionalParam('to', 'recipient address (if not using transferFile)')
  .addOptionalParam(
    'tokenids',
    'token ids (if not using transferFile), separate with comma',
  )
  .setAction(send721Batch);

task('freezeTrading', 'Freeze trading for 721Cv2')
  .addParam('contract', 'contract address')
  .addOptionalParam('validator', 'security validator')
  .addOptionalParam('level', 'security level')
  .addOptionalParam('whitelistid', 'whitelist id')
  .addOptionalParam('permittedreceiverid', 'permitted receiver list id')
  .setAction(freezeTrading);

task('thawTrading', 'Thaw trading for 721Cv2')
  .addParam('contract', 'contract address')
  .setAction(thawTrading);

task('cleanWhitelist', 'Clean up whitelist')
  .addOptionalParam('whitelistpath', 'plain whitelist path')
  .addOptionalParam('variablewalletlimitpath', 'variable wallet limit whitelist path')
  .setAction(cleanWhitelist)

task('deployCloneFactory', 'Deploy 721CMRoyalties clone factory')
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam('gaslimit', 'Set maximum gas units to spend on transaction')
  .setAction(deployCloneFactory)

task('deployClone', 'Create 721CMRoyalties cline')
  .addParam('name', 'name')
  .addParam('symbol', 'symbol')
  .addParam('maxsupply', 'max supply')
  .addParam('tokenurisuffix', 'token uri suffix', '.json')
  .addParam('globalwalletlimit', 'global wallet limit', '0')
  .addParam('timestampexpiryseconds', 'timestamp expiry in seconds', '300')
  .addParam('mintcurrency','ERC-20 contract address. 0x0 if using native token','0x0000000000000000000000000000000000000000')
  .addParam('fundreceiver', 'The treasury wallet to receive mint fund')
  .addParam('royaltyreceiver', 'erc2198 royalty receiver address')
  .addParam('royaltyfeenumerator', 'erc2198 royalty fee numerator')
  .addParam<boolean>(
    'openedition',
    'whether or not a open edition mint (unlimited supply, 999,999,999)',
    false,
    types.boolean,
  )
  .addOptionalParam('gaspricegwei', 'Set gas price in Gwei')
  .addOptionalParam('gaslimit', 'Set maximum gas units to spend on transaction')
  .setAction(deployClone);

export default config;
