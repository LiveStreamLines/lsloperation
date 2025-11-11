import { Injectable } from '@angular/core';

const TOKEN_KEY = 'lsl-operation/token';
const USER_KEY = 'lsl-operation/user';

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

@Injectable({
  providedIn: 'root',
})
export class TokenStorageService {
  private readonly storage: Storage;

  constructor() {
    if (typeof window !== 'undefined' && window.localStorage) {
      this.storage = window.localStorage;
    } else {
      this.storage = new MemoryStorage();
    }
  }

  saveToken(token: string): void {
    this.storage.setItem(TOKEN_KEY, token);
  }

  getToken(): string | null {
    return this.storage.getItem(TOKEN_KEY);
  }

  clearToken(): void {
    this.storage.removeItem(TOKEN_KEY);
  }

  saveUser(user: unknown): void {
    this.storage.setItem(USER_KEY, JSON.stringify(user));
  }

  getUser<T>(): T | null {
    const raw = this.storage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      this.storage.removeItem(USER_KEY);
      return null;
    }
  }

  clearUser(): void {
    this.storage.removeItem(USER_KEY);
  }

  clear(): void {
    this.clearToken();
    this.clearUser();
  }
}

