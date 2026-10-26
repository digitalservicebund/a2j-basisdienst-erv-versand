import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    amqpUrl: string;
  }
}
