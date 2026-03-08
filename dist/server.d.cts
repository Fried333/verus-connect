interface VerusAuthConfig {
    /** Your app's VerusID i-address (e.g. "iYour...") */
    iAddress: string;
    /** WIF private key for the VerusID */
    privateKey: string;
    /** Chain name (default: "VRSC") */
    chain?: string;
    /** Verus API endpoint (default: "https://api.verus.services") */
    apiUrl?: string;
    /** Chain i-address (default: VRSC mainnet) */
    chainIAddress?: string;
    /** Public URL where the wallet will POST the response (e.g. "https://yoursite.com/auth/verus/verusidlogin") */
    callbackUrl: string;
    /** Challenge TTL in ms (default: 300000 = 5 min) */
    challengeTtl?: number;
    /** Called when a login is verified — use this to create sessions, JWTs, etc. */
    onLogin?: (result: VerifiedLogin) => Promise<Record<string, unknown> | void>;
}
interface VerifiedLogin {
    /** The signer's i-address */
    iAddress: string;
    /** VerusID friendly name (e.g. "player3@") */
    friendlyName: string;
    /** The challenge ID that was verified */
    challengeId: string;
}

/**
 * Express middleware that adds VerusID login routes.
 *
 * Mounts four routes relative to where you attach it:
 *   POST /login              — create a new login challenge
 *   POST /verusidlogin       — receives the signed response from the wallet
 *   GET  /result/:id         — poll for the challenge result
 *   GET  /health             — health check
 *
 * Usage:
 *   app.use('/auth/verus', verusAuth({ iAddress, privateKey, callbackUrl }))
 */
declare function verusAuth(config: VerusAuthConfig): any;

export { type VerifiedLogin, type VerusAuthConfig, verusAuth };
