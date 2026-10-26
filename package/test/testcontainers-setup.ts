import { RabbitMQContainer } from "@testcontainers/rabbitmq";
import { type TestProject } from "vitest/node";

export async function setup(project: TestProject) {
  process.env["TESTCONTAINERS_RYUK_DISABLED"] ??= "true";

  const messageBroker = await new RabbitMQContainer(
    "rabbitmq:4.1-management-alpine",
  )
    .withReuse()
    .start();

  project.provide("amqpUrl", messageBroker.getAmqpUrl());

  return async function teardown() {
    await messageBroker.stop();
  };
}
