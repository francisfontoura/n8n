import type { Agent, AgentOptions as HttpsAgentOptionsNative } from 'https';
import type { AgentOptions as HttpAgentOptionsNative } from 'http';
import { HttpsProxyAgent, type HttpsProxyAgentOptions } from 'https-proxy-agent';

export interface N8nProxyAgentOptions {
	skipSslCertificateValidation?: boolean;
	servername?: string;
}

// This mirrors Axios's proxy config structure
export interface ExplicitProxyObject {
	protocol?: 'http' | 'https';
	host: string;
	port: number;
	auth?: {
		username?: string;
		password?: string;
	};
}

/**
 * Creates an HTTP/S agent that respects an explicit proxy if provided,
 * otherwise falls back to HTTP_PROXY, HTTPS_PROXY, and NO_PROXY environment variables.
 *
 * @param {string} targetUrl The URL the request is being made to.
 * @param {N8nProxyAgentOptions} options n8n-specific agent configurations.
 * @param {string | ExplicitProxyObject} [explicitProxyConfig] Optional explicit proxy string or object.
 * @returns {Agent} An HTTP/S agent instance.
 */
export function createN8nProxyAgent(
	targetUrl: string,
	options: N8nProxyAgentOptions = {},
	explicitProxyConfig?: string | ExplicitProxyObject,
): Agent {
	let proxyStringOrUrl: string | undefined;

	if (explicitProxyConfig) {
		if (typeof explicitProxyConfig === 'string') {
			proxyStringOrUrl = explicitProxyConfig;
		} else if (typeof explicitProxyConfig === 'object') {
			const protocol =
				explicitProxyConfig.protocol || (targetUrl.startsWith('https:') ? 'https' : 'http');
			const auth = explicitProxyConfig.auth
				? `${explicitProxyConfig.auth.username}:${explicitProxyConfig.auth.password}@`
				: '';
			if (explicitProxyConfig.host && explicitProxyConfig.port) {
				proxyStringOrUrl = `${protocol}://${auth}${explicitProxyConfig.host}:${explicitProxyConfig.port}`;
			}
		}
	} else {
		// Fallback to environment variables if no explicit proxy
		const httpsProxyEnv = process.env.HTTPS_PROXY || process.env.https_proxy;
		const httpProxyEnv = process.env.HTTP_PROXY || process.env.http_proxy;
		const protocolFromTarget = new URL(targetUrl).protocol;

		if (protocolFromTarget === 'https:') {
			proxyStringOrUrl = httpsProxyEnv;
		} else if (protocolFromTarget === 'http:') {
			// use HTTPS_PROXY for HTTP requests too if HTTP_PROXY is not set
			proxyStringOrUrl = httpProxyEnv || httpsProxyEnv;
		}
	}

	const targetUrlObj = new URL(targetUrl);
	const protocol = targetUrlObj.protocol;
	const hostname = targetUrlObj.hostname;

	let agent: Agent;
	let shouldUseProxy = !!proxyStringOrUrl;

	// Check NO_PROXY if we intend to use a proxy
	if (shouldUseProxy && proxyStringOrUrl) {
		const noProxy = process.env.NO_PROXY || process.env.no_proxy;
		if (noProxy) {
			const noProxyDomains = noProxy.split(',').map((d) => d.trim().toLowerCase());
			// More robust NO_PROXY handling might be needed for CIDR, ports, etc.
			// This is a basic check for domain suffixes and exact matches.
			if (
				noProxyDomains.some((domain) => {
					const lowerHostname = hostname.toLowerCase();
					if (domain.startsWith('.')) {
						// *.example.com
						return lowerHostname.endsWith(domain);
					}
					return lowerHostname === domain || lowerHostname.endsWith(`.${domain}`); // example.com or sub.example.com
				})
			) {
				shouldUseProxy = false;
			}
		}
	}

	// Base options for both proxied and non-proxied agents
	const commonAgentSettings: HttpsAgentOptionsNative & HttpAgentOptionsNative = {
		rejectUnauthorized: !options.skipSslCertificateValidation,
		// keepAlive: true,
	};

	if (options.servername && !shouldUseProxy) {
		// SNI for direct connections
		(commonAgentSettings as any).servername = options.servername;
	}

	if (shouldUseProxy && proxyStringOrUrl) {
		const proxyAgentOpts: HttpsProxyAgentOptions<string> = {
			...commonAgentSettings,
		};
		agent = new HttpsProxyAgent(proxyStringOrUrl, proxyAgentOpts);
	} else {
		if (protocol === 'https:') {
			const https = require('https');
			agent = new https.Agent(commonAgentSettings);
		} else {
			const http = require('http');
			agent = new http.Agent(commonAgentSettings);
		}
	}
	return agent;
}
