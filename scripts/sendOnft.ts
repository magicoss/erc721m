import { confirm } from '@inquirer/prompts';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { ChainIds, ContractDetails } from './common/constants';

export interface ISendOnftParams {
  contract: string;
  tokenid: string;
  targetnetwork: string;
  tokenowner?: string;
  newowner?: string;
  refundaddress?: string;
  zeropaymentaddress?: string;
}

export const sendOnft = async (
    args: ISendOnftParams,
    hre: HardhatRuntimeEnvironment,
  ) => {
    const supportedNetworks = Object.keys(ChainIds);
    if (!supportedNetworks.includes(args.targetnetwork)) {
      throw new Error(`Invalid network. Supported networks are: ${supportedNetworks.join(', ')}`);
    }

    const { ethers } = hre;
    const ERC721MOnft = await ethers.getContractFactory(
      ContractDetails.ERC721MOnft.name,
    );
    const contract = ERC721MOnft.attach(args.contract);

    const signers = await ethers.getSigners();
    const owner = signers[0].address;
    const targetChainId = ChainIds[args.targetnetwork];
    const newOwner = args.newowner ?? owner;
    const refundAddress = args.refundaddress ?? owner;
    const zeroPaymentAddress = args.refundaddress ?? ethers.constants.AddressZero;

    // quote fee with default adapterParams
    const adapterParams = ethers.utils.solidityPack(["uint16", "uint256"], [1, 200000]) // default adapterParams example
    const fees = await contract.estimateSendFee(targetChainId, newOwner, args.tokenid, /* useZro= */false, adapterParams);

    const nativeFee = fees[0];
    console.log(`native fees (wei): ${nativeFee}`);
    console.log(`Going to send tokenId: ${args.tokenid} from ${hre.network.name}/${args.contract} owned by ${owner} \n\rto \n\r trusted remote on ${args.targetnetwork} owned by ${newOwner} `);
    if (!await confirm({ message: 'Continue?' })) return;

    try {
        const tx = await contract.sendFrom(owner, targetChainId, newOwner, args.tokenid, refundAddress, zeroPaymentAddress, adapterParams, { value: nativeFee.mul(5).div(4) });
        console.log(`Submitted tx ${tx.hash}`);
        await tx.wait();
        console.log(`✅ Sent.`)
    } catch (error) {
        console.log(error);
    }
}

