import { Client, PrivateKey, AccountId, TokenId, TransferTransaction, TokenAssociateTransaction } from "@hashgraph/sdk";

const faucetLimits = new Map();
const IP_LIMITS = new Map();
const COOLDOWN_TIME = 24 * 60 * 60 * 1000;
const TOKEN_ID = TokenId.fromString("0.0.8198347");
const TOKEN_AMOUNT = 10;
const HEDERA_ACCOUNT_REGEX = /^0\.0\.\d+$/; // Regex to validate Hedera account format

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { walletAddress } = req.body;
    const userIP = req.headers["x-forwarded-for"] || req.connection.remoteAddress; 

    console.log("Received wallet address:", walletAddress);

    // ✅ Validate wallet address format before using it
    if (!HEDERA_ACCOUNT_REGEX.test(walletAddress)) {
        console.error("Invalid Hedera account format:", walletAddress);
        return res.status(400).json({ success: false, error: "Invalid Hedera account format. Use 0.0.xxxxx" });
    }

    try {
        const recipientAccount = AccountId.fromString(walletAddress);

        // Cooldown checks
        if (faucetLimits.has(walletAddress) && Date.now() - faucetLimits.get(walletAddress) < COOLDOWN_TIME) {
            return res.status(429).json({ success: false, error: "You can only claim once every 24 hours." });
        }
        if (IP_LIMITS.has(userIP) && Date.now() - IP_LIMITS.get(userIP) < COOLDOWN_TIME) {
            return res.status(429).json({ success: false, error: "This IP has already claimed in the last 24 hours." });
        }

        // Load Hedera credentials
        const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
        const operatorKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
        const client = Client.forTestnet().setOperator(operatorId, operatorKey);

        console.log(`Processing faucet request for ${walletAddress}`);
        console.log(`Parsed recipient account: ${recipientAccount.toString()}`);
        console.log(`Using Token ID: ${TOKEN_ID.toString()}`);

        // Step 1: Associate the wallet with the token if needed
        try {
            console.log(`Checking if wallet ${walletAddress} is associated with token ${TOKEN_ID}...`);

            const associateTx = await new TokenAssociateTransaction()
                .setAccountId(recipientAccount)
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
            .addTokenTransfer(TOKEN_ID, operatorId, -TOKEN_AMOUNT)
            .addTokenTransfer(TOKEN_ID, recipientAccount, TOKEN_AMOUNT)
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



