import { confirm } from '@inquirer/prompts';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { MerkleTree } from 'merkletreejs';
import fs from 'fs';
import { ContractDetails } from './common/constants';
import { cleanVariableWalletLimit, cleanWhitelist, estimateGas } from './utils/helper';
import { Overrides } from 'ethers';

export interface ISet1155StagesParams {
  stages: string;
  contract: string;
  gaspricegwei?: number;
  gaslimit?: number;
}

interface StageConfig {
  price: string;
  mintFee?: string;
  startDate: number;
  endDate: number;
  walletLimit?: number;
  maxSupply?: number;
  whitelistPath?: string;
  variableWalletLimitPath?: string;
}

export const set1155Stages = async (
  args: ISet1155StagesParams,
  hre: HardhatRuntimeEnvironment,
) => {
  const { ethers } = hre;
  const stagesConfig = JSON.parse(
    fs.readFileSync(args.stages, 'utf-8'),
  ) as StageConfig[];

  const factory = await ethers.getContractFactory(ContractDetails.ERC1155M.name);
  const contract = factory.attach(args.contract);

  const overrides: Overrides = {};
  if (args.gaspricegwei) {
    overrides.gasPrice = ethers.BigNumber.from(args.gaspricegwei * 1e9);
  }
  if (args.gaslimit) {
    overrides.gasLimit = ethers.BigNumber.from(args.gaslimit);
  }

  /*
   * Merkle root generation logic:
   * - for `whitelist`, leaves are `solidityKeccak256(['address', 'uint32'], [address, 0])`
   * - for `variable wallet limit list`, leaves are `solidityKeccak256(['address', 'uint32'], [address, limit])`
   */
  const merkleRoots = await Promise.all(
    stagesConfig.map(async (stage) => {
      if (stage.whitelistPath) {
        const filteredSet = await cleanWhitelist(stage.whitelistPath, true);
        const filteredWhitelist = Array.from(filteredSet.values());

        const mt = new MerkleTree(
          filteredWhitelist.map((address: string) =>
            ethers.utils.solidityKeccak256(
              ['address', 'uint32'],
              [ethers.utils.getAddress(address), 0],
            ),
          ),
          ethers.utils.keccak256,
          {
            sortPairs: true,
            hashLeaves: false,
          },
        );
        return mt.getHexRoot();
      } else if (stage.variableWalletLimitPath) {
        const filteredMap = await cleanVariableWalletLimit(stage.variableWalletLimitPath, true);
        const leaves: any[] = [];
        for (const [address, limit] of filteredMap.entries()) {
          const digest = ethers.utils.solidityKeccak256(
            ['address', 'uint32'],
            [address, limit],
          );
          leaves.push(digest);
        }

        const mt = new MerkleTree(leaves, ethers.utils.keccak256, {
          sortPairs: true,
          hashLeaves: false,
        });
        return mt.getHexRoot();
      }

      return ethers.utils.hexZeroPad('0x', 32);
    }),
  );

  const stages = stagesConfig.map((s, i) => ({
    price: [ethers.utils.parseEther(s.price)],
    mintFee: [s.mintFee ? ethers.utils.parseEther(s.mintFee) : 0],
    maxStageSupply: [s.maxSupply ?? 0],
    walletLimit: [s.walletLimit ?? 0],
    merkleRoot: [merkleRoots[i]],
    startTimeUnixSeconds: Math.floor(new Date(s.startDate).getTime() / 1000),
    endTimeUnixSeconds: Math.floor(new Date(s.endDate).getTime() / 1000),
  }));

  console.log(
    `Stage params: `,
    JSON.stringify(
      stages.map((stage) =>
        hre.ethers.BigNumber.isBigNumber(stage) ? stage.toString() : stage,
      ),
    ),
  );

  const tx = await contract.populateTransaction.setStages(stages);
  if (!(await estimateGas(hre, tx, overrides))) return;

  if (!(await confirm({ message: 'Continue to set stages?' }))) return;

  const submittedTx = await contract.setStages(stages, overrides);

  console.log(`Submitted tx ${submittedTx.hash}`);
  await submittedTx.wait();
  console.log('Stages set');

  for (let i = 0; i < stagesConfig.length; i++) {
    const [stage] = await contract.getStageInfo(i);
    console.log(`Stage ${i} info: ${stage}`);
  }
};
