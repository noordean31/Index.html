// Food data: a small built-in table (works fully offline), the user's own
// custom foods/recipes (stored locally, synced via drive-sync like everything
// else), and optional online lookup against the free OpenFoodFacts database
// (search-by-name and scan-by-barcode) when the device has network access.
import { getAll, put, uuid, nowISO } from './db.js';

// grams-based macros per 100g, kcal per 100g. Small curated starter set.
export const BUILTIN_FOODS = [
  { name: 'Pomme', kcal: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  { name: 'Banane', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  { name: 'Riz blanc cuit', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { name: 'Riz complet cuit', kcal: 123, protein: 2.6, carbs: 26, fat: 1 },
  { name: 'Pâtes cuites', kcal: 131, protein: 5, carbs: 25, fat: 1.1 },
  { name: 'Pain blanc', kcal: 265, protein: 9, carbs: 49, fat: 3.2 },
  { name: 'Pain complet', kcal: 247, protein: 13, carbs: 41, fat: 4.2 },
  { name: 'Poulet (blanc, cuit)', kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { name: 'Bœuf haché 5%', kcal: 137, protein: 21, carbs: 0, fat: 5 },
  { name: 'Saumon cuit', kcal: 208, protein: 20, carbs: 0, fat: 13 },
  { name: 'Œuf (1 = ~50g)', kcal: 155, protein: 13, carbs: 1.1, fat: 11 },
  { name: 'Yaourt nature', kcal: 61, protein: 3.5, carbs: 4.7, fat: 3.3 },
  { name: 'Fromage blanc 0%', kcal: 46, protein: 8, carbs: 4, fat: 0.2 },
  { name: 'Lait demi-écrémé', kcal: 46, protein: 3.4, carbs: 4.9, fat: 1.5 },
  { name: 'Avoine (flocons)', kcal: 389, protein: 17, carbs: 66, fat: 7 },
  { name: 'Amandes', kcal: 579, protein: 21, carbs: 22, fat: 50 },
  { name: 'Beurre de cacahuète', kcal: 588, protein: 25, carbs: 20, fat: 50 },
  { name: 'Huile d\'olive', kcal: 884, protein: 0, carbs: 0, fat: 100 },
  { name: 'Avocat', kcal: 160, protein: 2, carbs: 9, fat: 15 },
  { name: 'Brocoli cuit', kcal: 35, protein: 2.4, carbs: 7, fat: 0.4 },
  { name: 'Pomme de terre cuite', kcal: 87, protein: 1.9, carbs: 20, fat: 0.1 },
  { name: 'Lentilles cuites', kcal: 116, protein: 9, carbs: 20, fat: 0.4 },
  { name: 'Chocolat noir 70%', kcal: 598, protein: 7.8, carbs: 46, fat: 43 },
  { name: 'Tofu nature', kcal: 76, protein: 8, carbs: 1.9, fat: 4.8 },
].map((f, i) => ({
  id: `builtin-${i}`,
  name: f.name,
  kcalPer100: f.kcal,
  proteinPer100: f.protein,
  carbsPer100: f.carbs,
  fatPer100: f.fat,
  builtin: true,
}));

export async function getCustomFoods() {
  return getAll('foods');
}

export async function saveCustomFood(food) {
  const record = {
    id: food.id || uuid(),
    name: food.name,
    kcalPer100: Number(food.kcalPer100) || 0,
    proteinPer100: Number(food.proteinPer100) || 0,
    carbsPer100: Number(food.carbsPer100) || 0,
    fatPer100: Number(food.fatPer100) || 0,
    barcode: food.barcode || null,
    updatedAt: nowISO(),
    deleted: false,
  };
  await put('foods', record);
  return record;
}

export async function searchLocalFoods(query) {
  const q = query.trim().toLowerCase();
  const custom = await getCustomFoods();
  const all = [...custom, ...BUILTIN_FOODS];
  if (!q) return all.slice(0, 20);
  return all.filter(f => f.name.toLowerCase().includes(q)).slice(0, 30);
}

function normalizeOffProduct(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
  if (kcal == null) return null;
  return {
    id: `off-${p.code || p._id || Math.random().toString(36).slice(2)}`,
    name: p.product_name || p.generic_name || 'Produit sans nom',
    kcalPer100: Math.round(kcal),
    proteinPer100: Math.round((n.proteins_100g ?? 0) * 10) / 10,
    carbsPer100: Math.round((n.carbohydrates_100g ?? 0) * 10) / 10,
    fatPer100: Math.round((n.fat_100g ?? 0) * 10) / 10,
    barcode: p.code || null,
    fromOpenFoodFacts: true,
  };
}

export async function searchOpenFoodFacts(query) {
  if (!navigator.onLine) return [];
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=15&fields=code,product_name,generic_name,nutriments`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.products || []).map(normalizeOffProduct).filter(Boolean);
  } catch {
    return []; // offline or blocked — the app keeps working with local foods only
  }
}

export async function lookupBarcode(code) {
  if (!navigator.onLine) return null;
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=code,product_name,generic_name,nutriments`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1) return null;
    return normalizeOffProduct(data.product);
  } catch {
    return null;
  }
}

export function isBarcodeDetectorSupported() {
  return 'BarcodeDetector' in window;
}

export function computeForQuantity(food, grams) {
  const factor = grams / 100;
  return {
    kcal: Math.round(food.kcalPer100 * factor),
    protein: Math.round(food.proteinPer100 * factor * 10) / 10,
    carbs: Math.round(food.carbsPer100 * factor * 10) / 10,
    fat: Math.round(food.fatPer100 * factor * 10) / 10,
  };
}
