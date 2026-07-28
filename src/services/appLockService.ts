import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

// Keys live in the device keychain/keystore (expo-secure-store), never in
// AsyncStorage or Supabase — the app lock is a purely local control.
const PIN_HASH_KEY = "talo_app_lock_pin_hash";
const PIN_SALT_KEY = "talo_app_lock_pin_salt";
const BIOMETRICS_KEY = "talo_app_lock_biometrics";

async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${salt}:${pin}`
  );
}

export const appLockService = {
  /** SecureStore has no web backend — app lock is native-only. */
  isSupported(): boolean {
    return Platform.OS !== "web";
  },

  async isEnabled(): Promise<boolean> {
    if (!this.isSupported()) return false;
    return (await SecureStore.getItemAsync(PIN_HASH_KEY)) !== null;
  },

  /** Stores SHA-256(salt:pin); the raw PIN never touches disk. */
  async enable(pin: string): Promise<void> {
    const salt = Crypto.randomUUID();
    const hash = await hashPin(pin, salt);
    await SecureStore.setItemAsync(PIN_SALT_KEY, salt);
    await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
  },

  async disable(): Promise<void> {
    await SecureStore.deleteItemAsync(PIN_HASH_KEY);
    await SecureStore.deleteItemAsync(PIN_SALT_KEY);
    await SecureStore.deleteItemAsync(BIOMETRICS_KEY);
  },

  async verifyPin(pin: string): Promise<boolean> {
    const [salt, storedHash] = await Promise.all([
      SecureStore.getItemAsync(PIN_SALT_KEY),
      SecureStore.getItemAsync(PIN_HASH_KEY),
    ]);
    if (!salt || !storedHash) return false;
    return (await hashPin(pin, salt)) === storedHash;
  },

  // ============ Biometrics (opt-in shortcut over the PIN) ============

  async canUseBiometrics(): Promise<boolean> {
    if (!this.isSupported()) return false;
    const [hasHardware, isEnrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    return hasHardware && isEnrolled;
  },

  async isBiometricsEnabled(): Promise<boolean> {
    if (!this.isSupported()) return false;
    return (await SecureStore.getItemAsync(BIOMETRICS_KEY)) === "1";
  },

  async setBiometricsEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await SecureStore.setItemAsync(BIOMETRICS_KEY, "1");
    } else {
      await SecureStore.deleteItemAsync(BIOMETRICS_KEY);
    }
  },

  /** PIN stays available as fallback, so device-credential fallback is off. */
  async authenticateBiometric(promptMessage: string): Promise<boolean> {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: true,
    });
    return result.success;
  },
};
