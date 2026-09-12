import type { Scenario } from "@oathra/scenario";
import type { CalleeCharacter, CharacterFactory } from "../character.js";
import { HotelCharacter } from "./hotel.js";
import { RestaurantCharacter } from "./restaurant.js";
import { SerialCharacter } from "./serial.js";
import { ShopCharacter } from "./shop.js";
import { LlmCharacter } from "./llm.js";

const registry: Record<string, CharacterFactory> = {
  restaurant: (s) => new RestaurantCharacter(s),
  hotel: (s) => new HotelCharacter(s),
  shop: (s) => new ShopCharacter(s),
  serial: (s) => new SerialCharacter(s),
};

export function registerCharacter(domain: string, factory: CharacterFactory): void {
  registry[domain] = factory;
}

export function createCharacter(scenario: Scenario, rng: () => number): CalleeCharacter {
  const f = registry[scenario.domain];
  if (!f) {
    throw new Error(`No scripted character for domain "${scenario.domain}". Provide an LLM callee or use one of: ${Object.keys(registry).join(", ")}`);
  }
  return f(scenario, rng);
}

export { HotelCharacter, RestaurantCharacter, SerialCharacter, ShopCharacter, LlmCharacter };
export { parseCalleeJson, type ChatFn, type ChatMessage, type LlmCharacterOptions } from "./llm.js";
