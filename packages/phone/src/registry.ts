import type { VoiceEngine } from "@oathra/voice";
import type { PhoneConfig } from "./config.js";
import type { CarrierTransport, PhoneProvider, ProviderContext, RateEstimate, SipGateway } from "./types.js";

export class PhoneRegistry {
  private readonly providers = new Map<string, PhoneProvider>();
  private readonly gateways = new Map<string, SipGateway>();
  private readonly engines = new Map<string, VoiceEngine>();

  addProvider(p: PhoneProvider): this {
    this.providers.set(p.id, p);
    return this;
  }
  addGateway(g: SipGateway): this {
    this.gateways.set(g.id, g);
    return this;
  }
  addEngine(e: VoiceEngine): this {
    this.engines.set(e.id, e);
    return this;
  }
  provider(id: string): PhoneProvider | undefined {
    return this.providers.get(id);
  }
  gateway(id: string): SipGateway | undefined {
    return this.gateways.get(id);
  }
  engine(id: string): VoiceEngine | undefined {
    return this.engines.get(id);
  }
  listProviders(): PhoneProvider[] {
    return [...this.providers.values()];
  }
  listGateways(): SipGateway[] {
    return [...this.gateways.values()];
  }
  listEngines(): VoiceEngine[] {
    return [...this.engines.values()];
  }
}

export type Route = { provider: PhoneProvider; transport: CarrierTransport; rate?: RateEstimate };

/**
 * v0.1 routing: `preferred` order from config with fallback. Price is shown,
 * not used for selection, until real measurements exist.
 */
export class PhoneRouter {
  constructor(
    private readonly registry: PhoneRegistry,
    private readonly config: PhoneConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Providers that are configured and have their env vars, in preference order. */
  candidates(): Route[] {
    const order = this.config.routing.providers.length ? this.config.routing.providers : Object.keys(this.config.providers);
    const out: Route[] = [];
    for (const id of order) {
      const p = this.registry.provider(id);
      const cfg = this.config.providers[id];
      if (!p || !cfg) continue;
      if (p.requires.some((k) => !this.env[k])) continue;
      const gatewayId = typeof cfg.gateway === "string" ? cfg.gateway : this.config.gateway.id;
      const gateway = this.registry.gateway(gatewayId);
      const ctx: ProviderContext = { config: cfg, env: this.env, ...(gateway ? { gateway } : {}) };
      try {
        out.push({ provider: p, transport: p.transport(ctx) });
      } catch {
        /* provider not usable in this environment */
      }
    }
    return out;
  }

  resolve(opts: { destination: string; prefer?: string }): Route[] {
    let routes: Route[] = this.candidates().map((r) => {
      const rate = r.provider.pricing?.(opts.destination);
      return rate ? { ...r, rate } : r;
    });
    if (opts.prefer) {
      const i = routes.findIndex((r) => r.provider.id === opts.prefer);
      if (i < 0) throw new Error(`phone provider "${opts.prefer}" is not configured (oathra phone add ${opts.prefer})`);
      routes = [routes[i]!, ...routes.filter((_, j) => j !== i)];
    }
    return routes;
  }
}
