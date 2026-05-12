import pc from "picocolors";
import {
  printGoogleSetupSteps,
  printMicrosoftSetupSteps,
} from "./init.js";
import { DEFAULT_CLIENT_ID as DEFAULT_MS_CLIENT_ID } from "../auth/oauth-microsoft.js";

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
    if (DEFAULT_MS_CLIENT_ID) {
      console.log(
        pc.bold("Microsoft setup") +
          pc.dim(" — usually not required."),
      );
      console.log("");
      console.log(
        pc.dim(
          "  mmmail ships with a built-in Entra app, so the default flow needs zero Azure setup:",
        ),
      );
      console.log(
        `    ${pc.cyan("mmm add microsoft --email <you@outlook.com>")}`,
      );
      console.log("");
      console.log(
        pc.dim(
          "  Register your own Entra app only if you'd prefer mmmail to authorize through\n" +
            "  an app you own (e.g. an M365 tenant where your admin requires you-owned apps).\n" +
            "  Steps:",
        ),
      );
      console.log("");
    }
    printMicrosoftSetupSteps();
    console.log("");
    console.log(
      pc.dim(
        "  Then add an account: `mmm add microsoft --email <you@outlook.com> --client-id <id>`",
      ),
    );
    return;
  }
  console.error(pc.red(`Unknown provider: ${provider}`));
  process.exit(1);
}
