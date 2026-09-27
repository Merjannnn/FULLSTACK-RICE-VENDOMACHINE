/**
 * Shared Data Module for Rice Vending System
 * Manages transaction data storage and synchronization between kiosk and control panel
 */

const API_BASE_URL = "http://localhost:3001/api";

const SHARED_DATA = {
  // Storage keys
  KIOSK_TRANSACTIONS_KEY: "bigasan_kiosk_transactions",
  CONTROL_PANEL_STATE_KEY: "bigasan_control_panel_state",
  RICE_INVENTORY_KEY: "bigasan_rice_inventory",
  transactionSyncQueue: Promise.resolve(),

  async apiRequest(path, options = {}) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.warn(`API request failed for ${path}:`, error.message);
      return null;
    }
  },

  async fetchInventory() {
    const rows = await this.apiRequest("/inventory");
    if (!rows || !Array.isArray(rows)) return this.getRiceInventory();

    const mapped = {};
    rows.forEach((row) => {
      const key = String(row.name || "")
        .toLowerCase()
        .replace(/\s+/g, "");
      const normalizedKey = key.includes("jasmine")
        ? "jasmine"
        : key.includes("sinando")
          ? "sinandomeng"
          : key.includes("brown") || key.includes("pinawa")
            ? "brown"
            : null;

      if (!normalizedKey) return;
      const stock = Number(row.stock ?? 0);
      const capacity = Number(row.capacity ?? 100);
      mapped[normalizedKey] = {
        inventory_id: Number(row.id ?? 0),
        rice_type_id: Number(row.rice_type_id ?? row.id ?? 1),
        name: row.name,
        price: Number(row.current_price ?? row.price ?? 0),
        stock,
        stockPercent:
          capacity > 0
            ? Math.max(0, Math.min(100, Math.round((stock / capacity) * 100)))
            : 0,
        color:
          normalizedKey === "jasmine"
            ? "var(--jasmine)"
            : normalizedKey === "sinandomeng"
              ? "var(--sinandomeng)"
              : "var(--brown-rice)",
        dot:
          normalizedKey === "jasmine"
            ? "#EDE3CC"
            : normalizedKey === "sinandomeng"
              ? "#D9A94C"
              : "#7A5230",
      };
    });

    const inventory = { ...this.getDefaultRiceInventory(), ...mapped };
    this.saveRiceInventory(inventory);
    return inventory;
  },

  async fetchTransactions() {
    const payload = await this.apiRequest("/transactions?limit=200&offset=0");
    if (!payload || !Array.isArray(payload.data))
      return this.getKioskTransactions();
    return payload.data;
  },

  getDefaultRiceInventory() {
    return {
      jasmine: {
        name: "Jasmine",
        price: 55,
        stock: 10,
        stockPercent: 72,
        color: "var(--jasmine)",
        dot: "#EDE3CC",
      },
      sinandomeng: {
        name: "Sinandomeng",
        price: 48,
        stock: 10,
        stockPercent: 72,
        color: "var(--sinandomeng)",
        dot: "#D9A94C",
      },
      brown: {
        name: "Brown Rice",
        price: 60,
        stock: 0,
        stockPercent: 0,
        color: "var(--brown-rice)",
        dot: "#7A5230",
      },
    };
  },

  getRiceInventory() {
    try {
      const raw = localStorage.getItem(this.RICE_INVENTORY_KEY);
      const base = this.getDefaultRiceInventory();
      if (!raw) {
        localStorage.setItem(this.RICE_INVENTORY_KEY, JSON.stringify(base));
        return base;
      }
      const parsed = JSON.parse(raw);
      return { ...base, ...parsed };
    } catch (e) {
      console.error("Failed to load rice inventory:", e);
      return this.getDefaultRiceInventory();
    }
  },

  saveRiceInventory(inventory) {
    try {
      const safe = this.getDefaultRiceInventory();
      const next = { ...safe, ...(inventory || {}) };
      Object.keys(next).forEach((key) => {
        if (next[key] && typeof next[key].stock === "number") {
          if (
            !Number.isFinite(next[key].stockPercent) ||
            next[key].stockPercent === undefined
          ) {
            next[key].stockPercent = safe[key]?.stockPercent ?? 0;
          }
          next[key].stockPercent = Math.max(
            0,
            Math.min(100, Number(next[key].stockPercent) || 0),
          );
        }
      });
      localStorage.setItem(this.RICE_INVENTORY_KEY, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent("bigasan_inventory_updated", { detail: next }),
      );
      return next;
    } catch (e) {
      console.error("Failed to save rice inventory:", e);
      return this.getDefaultRiceInventory();
    }
  },

  onInventoryUpdate(callback) {
    const fire = (detail) => {
      if (detail) callback(detail);
    };

    window.addEventListener("bigasan_inventory_updated", (e) => {
      fire(e.detail);
    });

    window.addEventListener("storage", (e) => {
      if (e.key === this.RICE_INVENTORY_KEY && e.newValue) {
        try {
          fire(JSON.parse(e.newValue));
        } catch (err) {
          console.error("Failed to process shared inventory update:", err);
        }
      }
    });
  },

  syncPanelInventoryToKiosk(panelState) {
    const base = this.getDefaultRiceInventory();
    const panelContainers = Array.isArray(panelState?.containers)
      ? panelState.containers
      : [];
    const mapped = { ...base };

    panelContainers.forEach((container) => {
      const name = String(container.name || "").toLowerCase();
      const stock = Number(container.stock ?? 0);
      const capacity = Number(container.capacity || 100);
      const price = Number(container.price ?? 0);
      const pct =
        capacity > 0
          ? Math.max(0, Math.min(100, Math.round((stock / capacity) * 100)))
          : 0;

      if (name.includes("jasmine") && !name.includes("sinandomeng")) {
        mapped.jasmine = {
          ...mapped.jasmine,
          price: price || mapped.jasmine.price,
          stock: stock,
          stockPercent: pct,
        };
      } else if (name.includes("sinandomeng")) {
        mapped.sinandomeng = {
          ...mapped.sinandomeng,
          price: price || mapped.sinandomeng.price,
          stock: stock,
          stockPercent: pct,
        };
      } else if (name.includes("brown") && !name.includes("rice")) {
        // noop; Brown Rice handled by the exact match below
      } else if (name.includes("brown") || name.includes("pinawa")) {
        mapped.brown = {
          ...mapped.brown,
          price: price || mapped.brown.price,
          stock: stock,
          stockPercent: pct,
        };
      }
    });

    const brownMatch = panelContainers.find((container) => {
      const name = String(container.name || "").toLowerCase();
      return name.includes("brown") || name.includes("pinawa");
    });
    if (brownMatch) {
      const stock = Number(brownMatch.stock ?? 0);
      const capacity = Number(brownMatch.capacity || 80);
      const price = Number(brownMatch.price ?? 60);
      mapped.brown = {
        ...mapped.brown,
        price: price || mapped.brown.price,
        stock: stock,
        stockPercent:
          capacity > 0
            ? Math.max(0, Math.min(100, Math.round((stock / capacity) * 100)))
            : 0,
      };
    }

    const saved = this.saveRiceInventory(mapped);
    this.savePanelInventoryToDatabase(panelContainers).catch((error) => {
      console.warn(
        "Database inventory save failed; local storage is current:",
        error,
      );
    });
    return saved;
  },

  async savePanelInventoryToDatabase(panelContainers) {
    const inventory = await this.fetchInventory();
    const updates = panelContainers.map(async (container) => {
      const match = Object.values(inventory).find(
        (item) =>
          String(item.name || "").toLowerCase() ===
          String(container.name || "").toLowerCase(),
      );
      if (!match?.inventory_id) return;

      const response = await this.apiRequest(
        `/inventory/${match.inventory_id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            stock: Number(container.stock),
            capacity: Number(container.capacity),
            current_price: Number(container.price),
          }),
        },
      );
      if (!response?.success) {
        throw new Error(`Could not save ${container.name} inventory`);
      }
    });

    await Promise.all(updates);
  },

  /**
   * Save or update a kiosk transaction in shared local storage.
   */
  storeKioskTransaction(transaction) {
    const payload = {
      ...transaction,
      source: "kiosk",
      syncedAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      const existing = this.getKioskTransactions();
      const existingIndex = existing.findIndex(
        (item) => item.id === payload.id,
      );
      if (existingIndex === -1) existing.push(payload);
      else existing[existingIndex] = { ...existing[existingIndex], ...payload };
      localStorage.setItem(
        this.KIOSK_TRANSACTIONS_KEY,
        JSON.stringify(existing),
      );

      window.dispatchEvent(
        new CustomEvent("bigasan_transaction_saved", { detail: payload }),
      );

      return payload;
    } catch (e) {
      console.error("Failed to save kiosk transaction:", e);
      return null;
    }
  },

  queueKioskTransactionSync(transactionId) {
    this.transactionSyncQueue = this.transactionSyncQueue
      .catch(() => {})
      .then(async () => {
        const current = this.getKioskTransactions().find(
          (item) => item.id === transactionId,
        );
        if (!current) return;

        const inventory = await this.fetchInventory();
        const match = Object.values(inventory).find(
          (item) => item.name === current.variety,
        );
        const apiPayload = {
          rice_type_id: match ? Number(match.rice_type_id || 1) : 1,
          quantity_bought: Number(current.kilos || 0),
          price_per_unit: Number(current.pricePerKilo || 0),
          payment_method: current.paymentMethod || "cash",
          transaction_status: current.status || "completed",
        };

        const response = current.apiId
          ? await this.apiRequest(`/transactions/${current.apiId}`, {
              method: "PUT",
              body: JSON.stringify(apiPayload),
            })
          : await this.apiRequest("/transactions", {
              method: "POST",
              body: JSON.stringify(apiPayload),
            });

        if (!response?.success || current.apiId) return;
        const latest = this.getKioskTransactions().find(
          (item) => item.id === transactionId,
        );
        if (latest) {
          this.storeKioskTransaction({
            ...latest,
            apiId: response.transaction_id,
          });
        }
      });
    return this.transactionSyncQueue;
  },

  saveKioskPayment(transaction) {
    const payload = this.storeKioskTransaction({
      ...transaction,
      status: "pending",
    });
    if (payload) this.queueKioskTransactionSync(payload.id);
    return Boolean(payload);
  },

  async saveKioskTransaction(transaction) {
    const payload = this.storeKioskTransaction({
      ...transaction,
      status: "completed",
    });
    if (!payload) return false;
    await this.queueKioskTransactionSync(payload.id);
    return true;
  },

  /**
   * Get all kiosk transactions
   */
  getKioskTransactions() {
    try {
      const raw = localStorage.getItem(this.KIOSK_TRANSACTIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Failed to load kiosk transactions:", e);
      return [];
    }
  },

  /**
   * Clear all kiosk transactions
   */
  clearKioskTransactions() {
    localStorage.removeItem(this.KIOSK_TRANSACTIONS_KEY);
  },

  /**
   * Listen for transaction updates from kiosk
   * @param {Function} callback - Called when a new transaction is saved
   */
  onKioskTransaction(callback) {
    const fire = (detail) => {
      if (!detail) return;
      callback(detail);
    };

    window.addEventListener("bigasan_transaction_saved", (e) => {
      fire(e.detail);
    });

    window.addEventListener("storage", (e) => {
      if (e.key !== this.KIOSK_TRANSACTIONS_KEY || !e.newValue) return;
      try {
        const transactions = JSON.parse(e.newValue);
        const latest = transactions.reduce(
          (mostRecent, transaction) =>
            !mostRecent ||
            (transaction.updatedAt || transaction.timestamp) >
              (mostRecent.updatedAt || mostRecent.timestamp)
              ? transaction
              : mostRecent,
          null,
        );
        if (latest) {
          fire(latest);
        }
      } catch (err) {
        console.error(
          "Failed to process kiosk transaction storage update:",
          err,
        );
      }
    });
  },

  /**
   * Sync kiosk transactions into control panel state
   * @param {Object} controlPanelState - The control panel state object
   */
  syncKioskTransactionsToPanel(controlPanelState) {
    const kioskTransactions = this.getKioskTransactions();

    if (!controlPanelState.transactions) {
      controlPanelState.transactions = [];
    }

    // Add any kiosk transactions that aren't already in the panel
    kioskTransactions.forEach((kt) => {
      const existingIndex = controlPanelState.transactions.findIndex(
        (pt) => pt.id === kt.id,
      );
      if (existingIndex === -1) controlPanelState.transactions.push(kt);
      else {
        controlPanelState.transactions[existingIndex] = {
          ...controlPanelState.transactions[existingIndex],
          ...kt,
        };
      }
    });

    return controlPanelState;
  },
};

// Export for use in both applications
if (typeof module !== "undefined" && module.exports) {
  module.exports = SHARED_DATA;
}
