import { Client, PrivateKey, AccountId, TransferTransaction, Hbar } from "@hashgraph/sdk";
import crypto from "crypto";

const faucetLimits = new Map(); // Store claim timestamps (resets on restart)
const IP_LIMITS = new Map(); // Store IP claim timestamps (also resets on restart)
const CLAIM_AMOUNT = new Hbar(0.1); // Amount of HBAR given per claim
const COOLDOWN_TIME = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

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

        // Check cooldown for IP address (prevents multiple wallets from same IP)
        if (IP_LIMITS.has(userIP)) {
            const lastIPClaimTime = IP_LIMITS.get(userIP);
            if (Date.now() - lastIPClaimTime < COOLDOWN_TIME) {
                return res.status(429).json({ success: false, error: "This IP has already claimed HBAR in the last 24 hours." });
            }
        }

        // Load Hedera credentials from environment variables
        const operatorId = AccountId.fromString(process.env.HEDERA_ACCOUNT_ID);
        const operatorKey = PrivateKey.fromString(process.env.HEDERA_PRIVATE_KEY);
        const client = Client.forTestnet().setOperator(operatorId, operatorKey);

        // Send HBAR transaction
        const transaction = await new TransferTransaction()
            .addHbarTransfer(operatorId, CLAIM_AMOUNT.negated()) // Deduct from the faucet
            .addHbarTransfer(walletAddress, CLAIM_AMOUNT) // Send to user
            .execute(client);

        const receipt = await transaction.getReceipt(client);
        const txId = receipt.transactionId.toString();

        // Update cooldown timers
        faucetLimits.set(walletAddress, Date.now());
        IP_LIMITS.set(userIP, Date.now());

        res.status(200).json({ success: true, txId });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, error: error.message });
    }
}
