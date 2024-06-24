import axios from "axios";
import { Chain, createPublicClient, erc20Abi, formatUnits, http, parseEther } from "viem";
import { base, bsc, mainnet, zkSync } from "viem/chains";
import fs from 'fs';
import { encodePacked, keccak256 } from 'viem';
import { MerkleTree } from 'merkletreejs';

// Mainnet
const SDMAV_GAUGE_BLOCK_CREATED = 18270352;
const MAINNET_BLOCK_SNAPSHOT = 20021902;
const SDMAV_GAUGE_MAINNET_ADDRESS = "0x5B75C60D45BfB053f91B5a9eAe22519DFaa37BB6";
const ETHERSCAN_API_KEY = "H5TBJYKQWNDDCVRM3SW35WWS2I1ERF1QW2";

// Bsc
const SDMAV_BSC_BLOCK_CREATED = 31965008;
const BSC_BLOCK_SNAPSHOT = 39331960;
const SDMAV_BSC_ADDRESS = "0x75289388d50364c3013583d97bd70cED0e183e32";
const BSCSCAN_API_KEY = "85W438DTQPZZSM7SXWCI3Q69WV4YJ4FAF9";

// Base
const SDMAV_BASE_BLOCK_CREATED = 4298599;
const BASE_BLOCK_SNAPSHOT = 15378131;
const SDMAV_BASE_ADDRESS = "0x75289388d50364c3013583d97bd70cED0e183e32";
const BASESCAN_API_KEY = "NP12RMTFZCW3YHQ9M7T6K82JW8GHHVWX52";

// ZkSync
const SDMAV_ZKSYNC_BLOCK_CREATED = 15337815;
const ZKSYNC_BLOCK_SNAPSHOT = 35761590;
const SDMAV_ZKSYNC_ADDRESS = "0x8E6d4c0088b5B41BdDb126f355Ef278Ac5B5974C";
const ZKSYNCSCAN_API_KEY = "7913R1BXT5T33X2M6EI15TRNTRI84HA1VD";

// Amounts
const BSC_AMOUNT = "4629.737331900000239616";
const MAINNET_AMOUNT = "1513309.05179999998836736";
const BASE_AMOUNT = "5096.97"; // 5663.3 minus 10%
const ZKSYNC_AMOUNT = "25248.069"; // 28053.41 minus 10%

const INCREMENT = BigInt(50000);

interface ExplorerTransfer {
    address: `0x${string}`;
    topics: string[];
}

interface UserBalance {
    user: `0x${string}`;
    balance: string;
    isContract: boolean;
}

const fetchTransfersFromExplorer = async (explorerUrl: string, apiKey: string, tokenAddress: string, fromBlock: bigint, toBlock: bigint): Promise<ExplorerTransfer[]> => {

    const url = `${explorerUrl}/api?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}&address=${tokenAddress}&topic0=0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef&apikey=${apiKey}`;
    console.log(url)
    // Wait 0.5 secs
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
        const response = await axios.get(url);
        if (response.data && response.data.status === "1") {
            return response.data.result;
        } else {
            console.log(response)
            return [];
        }
    } catch (error) {
        console.error("Error fetching token balance:", error);
        throw error;
    }
}

const createMerkle = (chain: Chain, users: UserBalance[], airdropAmountStr: string): any => {
    const airdropAmount = parseEther(airdropAmountStr);
    const totalUserBalance = users.reduce((acc: bigint, user) => acc + parseEther(user.balance), BigInt(0));

    const elements: any[] = [];
    let total = BigInt(0);

    for (let i = 0; i < users.length; i++) {
        const userAddress = users[i].user.toLowerCase() as `0x${string}`;
        const userBalance = parseEther(users[i].balance);

        const amount = userBalance * airdropAmount / totalUserBalance;
        total += amount;
        elements.push(keccak256(encodePacked(["uint256", "address", "uint256"], [BigInt(i), userAddress, amount])));
    }

    const merkleTree = new MerkleTree(elements, keccak256, { sort: true });

    const merkle: any = {};
    for (let i = 0; i < users.length; i++) {
        const userAddress = users[i].user.toLowerCase();
        const userBalance = parseEther(users[i].balance);

        const amount = userBalance * airdropAmount / totalUserBalance;

        merkle[userAddress.toLowerCase()] = {
            index: i,
            amount: formatUnits(amount, 0),
            proof: merkleTree.getHexProof(elements[i]),
        };
    }

    fs.writeFileSync(`./merkles/${chain.id}.json`, JSON.stringify({
        "merkle": merkle,
        root: merkleTree.getHexRoot(),
        "total": formatUnits(total, 18),
    }, null, 2));
}

const createDistributionFile = (chain: Chain, users: UserBalance[], airdropAmountStr: string): any => {
    const airdropAmount = parseEther(airdropAmountStr);
    const totalUserBalance = users.reduce((acc: bigint, user) => acc + parseEther(user.balance), BigInt(0));

    const elements: any[] = [];
    let total = BigInt(0);

    for (let i = 0; i < users.length; i++) {
        const userAddress = users[i].user.toLowerCase() as `0x${string}`;
        const userBalance = parseEther(users[i].balance);

        const amount = userBalance * airdropAmount / totalUserBalance;
        total += amount;
        elements.push({
            user: userAddress,
            amount: amount.toString(),
            rawAmount: formatUnits(amount, 18)
        });
    }

    fs.writeFileSync(`./distributions/${chain.id}.json`, JSON.stringify({
        "users": elements,
        "total": formatUnits(total, 18),
    }, null, 2));
}

const fetch = async (startBlockNumber: number, snapshotBlock: number, explorerUrl: string, exploreApiKey: string, tokenAddress: string, chain: Chain, rpcUrl: string): Promise<UserBalance[]> => {

    let startBlock = BigInt(startBlockNumber);
    let users: Record<`0x${string}`, boolean> = {};

    while (startBlock < snapshotBlock) {
        const currentEndBlock = BigInt(Math.min(Number(startBlock + INCREMENT), snapshotBlock));
        console.log(`Fetching events from block ${startBlock} to ${currentEndBlock}`);
        const transfers = await fetchTransfersFromExplorer(explorerUrl, exploreApiKey, tokenAddress, startBlock, currentEndBlock);

        for (const transfer of transfers) {
            const to: `0x${string}` = `0x${(transfer as any).topics[2].slice(-40)}`;
            users[to.toLowerCase() as `0x${string}`] = true;
        }
        startBlock = currentEndBlock + BigInt(1);
    }

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl)
    });

    const usersAddresses = Object.keys(users);
    const calls = usersAddresses.map((user) => {
        return {
            address: tokenAddress,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [user]
        }
    });

    const responses = await publicClient.multicall({
        contracts: calls as any[],
        blockNumber: BigInt(snapshotBlock)
    });

    const userBalances: UserBalance[] = [];
    for (const user of usersAddresses) {
        const bytecode = await publicClient.getCode({
            address: user as `0x${string}`,
        });
        const isContract = bytecode !== undefined;

        const balance = responses.shift()?.result as bigint;
        if (balance > BigInt(0)) {
            userBalances.push({
                user: user as `0x${string}`,
                balance: formatUnits(balance, 18),
                isContract
            });
        }
    }

    fs.writeFileSync(`./snapshots/sdmav-${chain.id}.json`, JSON.stringify(userBalances.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance)), null, 2));

    return userBalances;
};

const main = async () => {
    // Mainnet
    let users = await fetch(
        SDMAV_GAUGE_BLOCK_CREATED,
        MAINNET_BLOCK_SNAPSHOT,
        "https://api.etherscan.io",
        ETHERSCAN_API_KEY,
        SDMAV_GAUGE_MAINNET_ADDRESS,
        mainnet,
        "https://eth-mainnet.g.alchemy.com/v2/kKOp_PsmE4UxfO9oIk4evDqupfYOXgej"
    );

    createMerkle(mainnet, users, MAINNET_AMOUNT);

    // BSC
    users = await fetch(
        SDMAV_BSC_BLOCK_CREATED,
        BSC_BLOCK_SNAPSHOT,
        "https://api.bscscan.com",
        BSCSCAN_API_KEY,
        SDMAV_BSC_ADDRESS,
        bsc,
        "https://lb.drpc.org/ogrpc?network=bsc&dkey=Ak80gSCleU1Frwnafb5Ka4VtAXxDLhcR76MthkHL9tz4"
    );

    createMerkle(bsc, users, BSC_AMOUNT);

    // Base
    users = await fetch(
        SDMAV_BASE_BLOCK_CREATED,
        BASE_BLOCK_SNAPSHOT,
        "https://api.basescan.org",
        BASESCAN_API_KEY,
        SDMAV_BASE_ADDRESS,
        base,
        "https://base-mainnet.g.alchemy.com/v2/kKOp_PsmE4UxfO9oIk4evDqupfYOXgej"
    );

    await createDistributionFile(base, users, BASE_AMOUNT);

    // ZKSync
    users = await fetch(
        SDMAV_ZKSYNC_BLOCK_CREATED,
        ZKSYNC_BLOCK_SNAPSHOT,
        "https://api-era.zksync.network",
        ZKSYNCSCAN_API_KEY,
        SDMAV_ZKSYNC_ADDRESS,
        zkSync,
        "https://zksync-mainnet.g.alchemy.com/v2/kKOp_PsmE4UxfO9oIk4evDqupfYOXgej"
    );

    await createDistributionFile(zkSync, users, ZKSYNC_AMOUNT);
};

main();