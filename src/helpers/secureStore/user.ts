import * as SecureStore from "expo-secure-store";
import {
  clearPendingDataLogoutBeforeLoginInsideLockAsync,
  DataOwner,
  DataRecoveryError,
  withDataJournalLockAsync,
} from "../dataJournal";
import { logAndThrowError } from "../debug";
import { getSSKeyAsync } from "./secureStore";

export type User = {
  username: string;
  password: string;
  /**
   * The date when the user first logged in. This will be used in conjuction
   * with the installation ID to unique determine a user's login session.
   *
   * We store `number` (from `.getTime()`) instead of `Date` because we don't
   * have to convert it back to `Date` when `secureGetUserAsync()`.
   */
  loginDate: number;
};

const USER_KEY = `user`;

export async function secureStoreUserAsync(user: User) {
  try {
    const value = JSON.stringify(user);
    await withDataJournalLockAsync(async () => {
      await clearPendingDataLogoutBeforeLoginInsideLockAsync();
      await SecureStore.setItemAsync(await getSSKeyAsync(USER_KEY), value);
    });
  } catch (error) {
    logAndThrowError(error);
  }
}

export async function secureClearUserAsync(owner?: DataOwner) {
  try {
    await withDataJournalLockAsync(async () => {
      const key = owner
        ? `${owner.secureNamespace}${USER_KEY}`
        : await getSSKeyAsync(USER_KEY);
      const value = await SecureStore.getItemAsync(key);
      if (value === null) return;
      if (owner) {
        const current = JSON.parse(value) as User;
        if (
          current.username !== owner.username ||
          current.loginDate !== owner.loginDate
        )
          throw new DataRecoveryError("LOGOUT_OWNER_MISMATCH");
      }
      await SecureStore.deleteItemAsync(key);
      if ((await SecureStore.getItemAsync(key)) !== null)
        throw new DataRecoveryError("LOGOUT_USER_STILL_PRESENT");
    });
  } catch (error) {
    logAndThrowError(error);
  }
}

export async function secureGetUserAsync(): Promise<User | null> {
  try {
    const value = await SecureStore.getItemAsync(await getSSKeyAsync(USER_KEY));
    if (value == null) {
      return null;
    }
    const user: User = JSON.parse(value);
    return user;
  } catch (error) {
    logAndThrowError(error);
  }
}
