import { confirm } from '@inquirer/prompts';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ContractDetails } from './common/constants';
import { checkCodeVersion, estimateGas } from './utils/helper';
import { Overrides } from 'ethers';

interface IDeploy1155Params {
  name: string;
  symbol: string;
  uri: string;
  maxsupply: string;
  globalwalletlimit: string;
  mintcurrency?: string;
  fundreceiver?: string;
  erc2198royaltyreceiver?: string;
  erc2198royaltyfeenumerator?: number;
  openedition?: boolean;
  gaspricegwei?: number;
  gaslimit?: number;
}

export const deploy1155 = async (
  args: IDeploy1155Params,
  hre: HardhatRuntimeEnvironment,
) => {
  if (!(await checkCodeVersion())) {
    return;
  }

  // Compile again in case we have a coverage build (binary too large to deploy)
  await hre.run('compile');
  const contractName: string = ContractDetails.ERC1155M.name;

  console.log(args);

  const maxsupply = args.maxsupply.split(',').map(supply => 
    args.openedition? hre.ethers.BigNumber.from(0) : hre.ethers.BigNumber.from(supply.trim())
  )

  const globalwalletlimit = args.globalwalletlimit.split(',').map(limit =>
    hre.ethers.BigNumber.from(limit.trim())
  );

  const overrides: Overrides = {};
  if (args.gaspricegwei) {
    overrides.gasPrice = hre.ethers.BigNumber.from(args.gaspricegwei * 1e9);
  }
  if (args.gaslimit) {
    overrides.gasLimit = hre.ethers.BigNumber.from(args.gaslimit);
  }

  const [signer] = await hre.ethers.getSigners();
  const contractFactory = await hre.ethers.getContractFactory(contractName, signer);

  const params = [
    args.name,
    args.symbol,
    args.uri,
    maxsupply,
    globalwalletlimit,
    args.mintcurrency ?? hre.ethers.constants.AddressZero,
    args.fundreceiver ?? signer.address,
    args.erc2198royaltyreceiver,
    args.erc2198royaltyfeenumerator 
  ] as any[];

  console.log(
    `Going to deploy ${contractName} with params`,
    JSON.stringify(args, null, 2),
  );

  if (
    !(await estimateGas(
      hre,
      contractFactory.getDeployTransaction(...params),
      overrides,
    ))
  ) {
    return;
  }
  
  if (!(await confirm({ message: 'Continue to deploy?' }))) return;

  const contract = await contractFactory.deploy(...params, overrides);
  console.log('Deploying contract... ');
  console.log('tx:', contract.deployTransaction.hash);

  await contract.deployed();

  console.log(`${contractName} deployed to:`, contract.address);
  console.log('run the following command to verify the contract:');
  const paramsStr = params
    .map((param) => {
      if (hre.ethers.BigNumber.isBigNumber(param)) {
        return `"${param.toString()}"`;
      }
      return `"${param}"`;
    })
    .join(' ');

  console.log(
    `npx hardhat verify --network ${hre.network.name} ${contract.address} ${paramsStr}`,
  );
};
