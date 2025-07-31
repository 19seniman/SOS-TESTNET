const { ethers } = require("ethers");
require("dotenv").config();

const colors = {
    reset: "\x1b[0m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    white: "\x1b[37m",
    bold: "\x1b[1m",
    magenta: "\x1b[35m",
    blue: "\x1b[34m",
    gray: "\x1b[90m",
};

const logger = {
    info: (msg) => console.log(`${colors.cyan}[i] ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}[!] ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}[x] ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}[+] ${msg}${colors.reset}`),
    loading: (msg) => console.log(`${colors.magenta}[*] ${msg}${colors.reset}`),
    step: (msg) => console.log(`${colors.blue}[>] ${colors.bold}${msg}${colors.reset}`),
    critical: (msg) => console.log(`${colors.red}${colors.bold}[FATAL] ${msg}${colors.reset}`),
    summary: (msg) => console.log(`${colors.green}${colors.bold}[SUMMARY] ${msg}${colors.reset}`),
    banner: () => {
        const border = `${colors.blue}${colors.bold}╔═════════════════════════════════════════╗${colors.reset}`;
        const title = `${colors.blue}${colors.bold}║      🍉 19Seniman From Insider 🍉      ║${colors.reset}`;
        const bottomBorder = `${colors.blue}${colors.bold}╚═════════════════════════════════════════╝${colors.reset}`;
        
        console.log(`\n${border}`);
        console.log(`${title}`);
        console.log(`${bottomBorder}\n`);
    },
    section: (msg) => {
        const line = '─'.repeat(40);
        console.log(`\n${colors.gray}${line}${colors.reset}`);
        if (msg) console.log(`${colors.white}${colors.bold} ${msg} ${colors.reset}`);
        console.log(`${colors.gray}${line}${colors.reset}\n`);
    },
    countdown: (msg) => process.stdout.write(`\r${colors.blue}[⏰] ${msg}${colors.reset}`),
};


const config = {
    RPC_URL: "https://testnet-rpc.x.ink/",
    CHAIN_ID: 1267,
    CONTRACTS: {
        SWAP_ROUTER_02: "0xdc7D6b58c89A554b3FDC4B5B10De9b4DbF39FB40",
        TOKEN_CREATOR: "0xEBB7781329f101F0FDBC90A3B6f211082863884B",
        WXOS: "0x0AAB67cf6F2e99847b9A95DeC950B250D648c1BB",
        USDC: "0xb2C1C007421f0Eb5f4B3b3F38723C309Bb208d7d",
    },
    // Konfigurasi untuk swap otomatis
    AUTO_SWAP_CONFIG: {
        XOS_TO_USDC_AMOUNT: "0.001", // Jumlah XOS yang akan di-swap
        USDC_TO_XOS_AMOUNT: "0.05", // Jumlah USDC yang akan di-swap
        TRANSACTIONS_PER_WALLET: 19, // Jumlah transaksi per dompet untuk setiap siklus
    }
};

const ABIs = {
    SWAP_ROUTER_02: new ethers.Interface([
        "function multicall(uint256 deadline, bytes[] calldata data) payable returns (bytes[] memory results)",
        "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable",
        "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
    ]),
    ERC20: new ethers.Interface([
        "function approve(address spender, uint256 amount) returns (bool)",
        "function allowance(address owner, address spender) view returns (uint256)",
    ]),
};

const provider = new ethers.JsonRpcProvider(config.RPC_URL);

// Fungsi utilitas untuk jeda
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fungsi untuk menampilkan hitung mundur
async function startCountdown(duration) {
    let remaining = duration;
    while (remaining > 0) {
        const hours = Math.floor((remaining / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
        const minutes = Math.floor((remaining / (1000 * 60)) % 60).toString().padStart(2, '0');
        const seconds = Math.floor((remaining / 1000) % 60).toString().padStart(2, '0');
        
        logger.countdown(`Next cycle starts in: ${hours}:${minutes}:${seconds}`);
        remaining -= 1000;
        await delay(1000);
    }
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Hapus baris hitung mundur
}


async function handleSwapXosToUsdc(wallet, amountIn, txIndex) {
    try {
        logger.loading(`[${wallet.address}] [Tx ${txIndex}] Processing XOS -> USDC swap...`);
        const routerContract = new ethers.Contract(config.CONTRACTS.SWAP_ROUTER_02, ABIs.SWAP_ROUTER_02, wallet);
        const deadline = Math.floor(Date.now() / 1000) + (60 * 15);

        const params = {
            tokenIn: config.CONTRACTS.WXOS,
            tokenOut: config.CONTRACTS.USDC,
            fee: 500,
            recipient: wallet.address,
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        };

        const encodedData = ABIs.SWAP_ROUTER_02.encodeFunctionData("exactInputSingle", [params]);
        const tx = await routerContract.multicall(deadline, [encodedData], { value: amountIn, gasLimit: 300000 });
        const receipt = await tx.wait();
        
        logger.success(`[${wallet.address}] [Tx ${txIndex}] Swap XOS -> USDC successful! Hash: ${receipt.hash}`);
    } catch (e) {
        logger.error(`[${wallet.address}] [Tx ${txIndex}] Failed to swap XOS -> USDC: ${e.message}`);
    }
}

async function handleSwapUsdcToXos(wallet, amountIn, txIndex) {
    try {
        const routerContract = new ethers.Contract(config.CONTRACTS.SWAP_ROUTER_02, ABIs.SWAP_ROUTER_02, wallet);
        const usdcContract = new ethers.Contract(config.CONTRACTS.USDC, ABIs.ERC20, wallet);

        logger.loading(`[${wallet.address}] [Tx ${txIndex}] Checking allowance and approving USDC...`);
        const allowance = await usdcContract.allowance(wallet.address, config.CONTRACTS.SWAP_ROUTER_02);
        
        if (allowance < amountIn) {
            const approveTx = await usdcContract.approve(config.CONTRACTS.SWAP_ROUTER_02, ethers.MaxUint256);
            await approveTx.wait();
            logger.success(`[${wallet.address}] [Tx ${txIndex}] USDC approval successful.`);
        } else {
            logger.info(`[${wallet.address}] [Tx ${txIndex}] Allowance is sufficient, skipping approval.`);
        }
        
        logger.loading(`[${wallet.address}] [Tx ${txIndex}] Processing USDC to XOS swap...`);
        const deadline = Math.floor(Date.now() / 1000) + (60 * 15);

        const swapParams = {
            tokenIn: config.CONTRACTS.USDC,
            tokenOut: config.CONTRACTS.WXOS,
            fee: 500,
            recipient: config.CONTRACTS.SWAP_ROUTER_02, // Kirim WXOS ke router untuk di-unwrap
            amountIn: amountIn,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0,
        };
        
        const encodedSwapData = ABIs.SWAP_ROUTER_02.encodeFunctionData("exactInputSingle", [swapParams]);
        const encodedUnwrapData = ABIs.SWAP_ROUTER_02.encodeFunctionData("unwrapWETH9", [0, wallet.address]);

        const tx = await routerContract.multicall(deadline, [encodedSwapData, encodedUnwrapData], { gasLimit: 400000 });
        const receipt = await tx.wait();
        
        logger.success(`[${wallet.address}] [Tx ${txIndex}] Swap USDC -> XOS successful! Hash: ${receipt.hash}`);
    } catch (e) {
        logger.error(`[${wallet.address}] [Tx ${txIndex}] Failed to swap USDC -> XOS: ${e.message}`);
    }
}

// Fungsi utama untuk menjalankan siklus swap otomatis
async function runAutomatedCycle(wallets) {
    const { XOS_TO_USDC_AMOUNT, USDC_TO_XOS_AMOUNT, TRANSACTIONS_PER_WALLET } = config.AUTO_SWAP_CONFIG;
    const amountInXos = ethers.parseEther(XOS_TO_USDC_AMOUNT);
    const amountInUsdc = ethers.parseUnits(USDC_TO_XOS_AMOUNT, 6);

    logger.section("STARTING AUTOMATED SWAP CYCLE");

    for (let i = 0; i < TRANSACTIONS_PER_WALLET; i++) {
        const txIndex = i + 1;
        logger.step(`--- Starting Transaction Batch ${txIndex} of ${TRANSACTIONS_PER_WALLET} ---`);

        // Fase 1: Swap XOS -> USDC untuk semua dompet
        logger.info("Phase 1: Swapping XOS to USDC");
        for (const wallet of wallets) {
            await handleSwapXosToUsdc(wallet, amountInXos, txIndex);
            await delay(3000); // Jeda antar dompet
        }
        logger.info("Phase 1 completed.");
        await delay(5000); // Jeda antar fase

        // Fase 2: Swap USDC -> XOS untuk semua dompet
        logger.info("Phase 2: Swapping USDC to XOS");
        for (const wallet of wallets) {
            await handleSwapUsdcToXos(wallet, amountInUsdc, txIndex);
            await delay(3000); // Jeda antar dompet
        }
        logger.info("Phase 2 completed.");
        await delay(5000); // Jeda antar batch transaksi
    }

    logger.summary("AUTOMATED SWAP CYCLE COMPLETED SUCCESSFULLY");
}


async function main() {
    const wallets = Object.keys(process.env)
        .filter((key) => key.startsWith("PRIVATE_KEY_"))
        .map((key) => new ethers.Wallet(process.env[key], provider));

    if (wallets.length === 0) {
        logger.critical("No PRIVATE_KEY found in the .env file");
        logger.warn("Make sure the .env file exists and contains PRIVATE_KEY_1=..., PRIVATE_KEY_2=..., etc.");
        return;
    }

    logger.banner();
    logger.success(`Successfully loaded ${wallets.length} wallets.`);
    wallets.forEach((w, i) => logger.info(`  Wallet ${i+1}: ${w.address}`));
    
    while (true) {
        await runAutomatedCycle(wallets);
        
        const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
        logger.section("WAITING FOR NEXT 24-HOUR CYCLE");
        await startCountdown(twentyFourHoursInMs);
    }
}

main().catch((err) => {
    logger.critical("A fatal error occurred in the main loop:");
    console.error(err);
    process.exit(1);
});
