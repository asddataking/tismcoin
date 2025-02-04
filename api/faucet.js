import { Client, PrivateKey, AccountId, TokenId, TransferTransaction, TokenAssociateTransaction } from "@hashgraph/sdk";

const faucetLimits = new Map(); // Store claim timestamps (resets on restart)
const IP_LIMITS = new Map(); // Store IP claim timestamps (also resets on restart)
const COOLDOWN_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// ✅ Hardcoded Token ID
const TOKEN_ID = TokenId.fromString("0.0.8198347"); 
const TOKEN_AMOUNT = 10; // Number of tokens to send per claim

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { walletAddress } = req.body;
    const userIP = req.headers["x-forwarded-for"] || req.connection.remoteAddress; // Get user IP

    if (!walletAddress) return res.status(400).send("Missing wallet address");

    try {
        // Check cooldown for wallet address
        if (faucetLimits.has(walletAddress)) {
            const lastClaimTime = faucetLimits.get(walletAddress);
            if (Date.now() - lastClaimTime < COOLDOWN_TIME) {
                return res.status(429).json({ success: false, error: "You can only claim once every 24 hours." });
            }
        }

        // Check cooldown for IP address
        if (IP_LIMITS.has(userIP)) {
            const lastIPClaimTime = IP_LIMITS.get(userIP);
            if (Date.now() - lastIPClaimTime < COOLDOWN_TIME) {
                return res.status(429).json({ success: false, error: "This IP has already claimed in the last 24 hours." });
            }
        }

        // Load Hedera credentials from environment variables
        const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
        const operatorKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
        const client = Client.forTestnet().setOperator(operatorId, operatorKey);

        console.log(`Processing faucet request for ${walletAddress}`);
        console.log(`Using Token ID: ${TOKEN_ID.toString()}`);

        // Step 1: Associate the wallet with the token if needed
        try {
            console.log(`Checking if wallet ${walletAddress} is associated with token ${TOKEN_ID}...`);

            const associateTx = await new TokenAssociateTransaction()
                .setAccountId(walletAddress)
                .setTokenIds([TOKEN_ID])
                .freezeWith(client)
                .sign(operatorKey);

            const associateResponse = await associateTx.execute(client);
            const associateReceipt = await associateResponse.getReceipt(client);

            if (associateReceipt.status.toString() === "SUCCESS") {
                console.log(`Wallet ${walletAddress} successfully associated with token ${TOKEN_ID}`);
            } else {
                console.error(`Failed to associate wallet ${walletAddress} with token ${TOKEN_ID}`);
            }
        } catch (err) {
            console.log("Skipping association; wallet may already be associated.");
        }

        // Step 2: Send HTS Tokens
        console.log(`Sending ${TOKEN_AMOUNT} tokens to ${walletAddress}...`);
        const transaction = await new TransferTransaction()
            .addTokenTransfer(TOKEN_ID, operatorId, -TOKEN_AMOUNT) // Deduct from faucet
            .addTokenTransfer(TOKEN_ID, walletAddress, TOKEN_AMOUNT) // Send to user
            .execute(client);

        const receipt = await transaction.getReceipt(client);
        const txId = receipt.transactionId.toString();

        // Update cooldown timers
        faucetLimits.set(walletAddress, Date.now());
        IP_LIMITS.set(userIP, Date.now());

        console.log(`Successfully sent ${TOKEN_AMOUNT} tokens to ${walletAddress} (TxID: ${txId})`);

        res.status(200).json({ success: true, txId });

    } catch (error) {
        console.error("Faucet Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
}

