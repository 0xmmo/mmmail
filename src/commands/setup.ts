import pc from "picocolors";
import { printGoogleSetupSteps } from "./init.js";

export async function runSetup(provider?: string): Promise<void> {
  if (!provider || provider === "google") {
    printGoogleSetupSteps();
    if (!provider) {
      console.log("");
      console.log(
        pc.dim(
          "  Then add an account: `mmm add google --client-id <id> --client-secret <secret> --email <you@gmail.com>`",
        ),
      );
    }
    return;
  }
  if (provider === "microsoft") {
    console.log(pc.yellow("Microsoft setup is not yet supported."));
    return;
  }
  console.error(pc.red(`Unknown provider: ${provider}`));
  process.exit(1);
}
