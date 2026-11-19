import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as FileSystem from "expo-file-system/legacy";
import { Check, FileText, Share2 } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePortfolio, usePropertyPhotos, usePropertyReminders, usePropertyTransactions } from "@/hooks/portfolio-store";
import { parseStoredDate } from "@/lib/dates";

const SUMMARY_FIELDS = [
  { key: "property", label: "Property name and address", safeDefault: true },
  { key: "propertyDetails", label: "Property type, purchase date, and square footage", safeDefault: true },
  { key: "maintenance", label: "Appliances, paint, AC, and water heater details", safeDefault: true },
  { key: "photos", label: "Property photos and captions", safeDefault: true },
  { key: "reminders", label: "Upcoming reminders", safeDefault: true },
  { key: "maintenanceLog", label: "Maintenance log (issues, repairs, costs, tags, follow-up)", safeDefault: false },
  { key: "rent", label: "Monthly rent", safeDefault: false },
  { key: "financial", label: "Purchase price, value, mortgage, insurance, and taxes", safeDefault: false },
  { key: "tenant", label: "Tenant name, contact, and lease dates", safeDefault: false },
  { key: "transactions", label: "Income and expense totals", safeDefault: false },
  { key: "notes", label: "Internal property notes", safeDefault: false },
] as const;

type SummaryField = typeof SUMMARY_FIELDS[number]["key"];

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const dateText = (value?: string) => value ? parseStoredDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not provided";
const safeFilenamePart = (value: string) => value
  .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/[. ]+$/g, "")
  .slice(0, 80) || "Property";

export default function PropertySummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { properties, maintenanceLogs } = usePortfolio();
  const property = properties.find(item => item.id === id);
  const transactions = usePropertyTransactions(id || "");
  const reminders = usePropertyReminders(id || "");
  const photos = usePropertyPhotos(id || "");
  const propertyMaintenanceLogs = maintenanceLogs.filter(entry => entry.propertyId === id);
  const [selected, setSelected] = useState<Set<SummaryField>>(() => new Set(SUMMARY_FIELDS.filter(field => field.safeDefault).map(field => field.key)));
  const [isGenerating, setIsGenerating] = useState(false);

  const totals = useMemo(() => ({
    income: transactions.filter(item => item.type === "income").reduce((sum, item) => sum + item.amount, 0),
    expenses: transactions.filter(item => item.type === "expense").reduce((sum, item) => sum + item.amount, 0),
  }), [transactions]);

  if (!property) {
    return <SafeAreaView style={styles.container}><Text style={styles.missing}>Property not found.</Text></SafeAreaView>;
  }

  const toggle = (field: SummaryField) => {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(field)) next.delete(field); else next.add(field);
      return next;
    });
  };

  const list = (title: string, rows: string[]) => rows.filter(Boolean).length > 0
    ? `<section><h2>${escapeHtml(title)}</h2>${rows.filter(Boolean).map(row => `<p>${escapeHtml(row)}</p>`).join("")}</section>`
    : "";

  const buildHtml = () => {
    const sections: string[] = [];
    if (selected.has("property")) sections.push(list("Property", [`${property.name}`, `Address: ${property.address}`]));
    if (selected.has("propertyDetails")) sections.push(list("Property details", [`Type: ${property.type}`, `Purchase date: ${dateText(property.purchaseDate)}`, `Square footage: ${property.squareFootage ? `${property.squareFootage.toLocaleString()} sq ft` : "Not provided"}`]));
    if (selected.has("rent")) sections.push(list("Rental", [`Monthly rent: ${money(property.monthlyRent)}`]));
    if (selected.has("financial")) sections.push(list("Financial and policy details", [
      `Purchase price: ${money(property.purchasePrice)}`,
      `Current value: ${property.currentValue ? money(property.currentValue) : "Not provided"}`,
      `Mortgage amount: ${property.mortgageAmount ? money(property.mortgageAmount) : "Not provided"}`,
      `Mortgage payment: ${property.mortgagePayment ? money(property.mortgagePayment) : "Not provided"}`,
      `Insurance provider: ${property.insuranceProvider || "Not provided"}`,
      `Insurance policy: ${property.insurancePolicy || "Not provided"}`,
      `Property tax: ${property.propertyTax ? money(property.propertyTax) : "Not provided"}`,
    ]));
    if (selected.has("tenant")) sections.push(list("Occupancy", [`Tenant: ${property.tenantName || "Not provided"}`, `Tenant contact: ${property.tenantContact || "Not provided"}`, `Lease: ${dateText(property.leaseStart)} - ${dateText(property.leaseEnd)}`]));
    if (selected.has("maintenance")) sections.push(list("Maintenance and systems", [`Appliances: ${property.applianceInfo || "Not provided"}`, `Water heater: ${property.waterHeaterInfo || "Not provided"}`, `AC filter: ${property.acFilterSize || "Not provided"}`, `AC capacitor: ${property.acCapacitorSize || "Not provided"}`, `Interior paint: ${property.paintColorsInside || "Not provided"}`, `Exterior paint: ${property.paintColorsOutside || "Not provided"}`]));
    if (selected.has("reminders")) sections.push(list("Upcoming reminders", reminders.map(reminder => `${reminder.title} - ${dateText(reminder.dueDate)}`)));
    if (selected.has("maintenanceLog")) sections.push(list("Maintenance log", propertyMaintenanceLogs.flatMap(entry => [
      `Issue: ${entry.issue}`,
      `Date notified: ${dateText(entry.dateNotified)}`,
      `Date repaired: ${dateText(entry.dateRepaired)}`,
      `Cost: ${entry.cost == null ? "Not recorded" : money(entry.cost)}`,
      `Responsible: ${entry.responsibility}`,
      `Equipment: ${entry.equipmentTags.join(", ") || "Not tagged"}`,
      `Follow-up: ${entry.followUpNeeded ? entry.followUpDetails || "Needed" : "No"}`,
      entry.notes ? `Notes: ${entry.notes}` : "",
    ])));
    if (selected.has("transactions")) sections.push(list("Financial totals", [`Income total: ${money(totals.income)}`, `Expense total: ${money(totals.expenses)}`, `Net total: ${money(totals.income - totals.expenses)}`]));
    if (selected.has("notes")) sections.push(list("Internal notes", [property.notes || "No notes provided"]));

    return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;color:#172033;padding:32px}header{border-bottom:4px solid #2563eb;padding-bottom:18px}h1{font-size:30px;margin:0 0 8px}h2{color:#2563eb;font-size:19px;border-bottom:1px solid #dbe4f0;padding-bottom:6px;margin-top:26px}p{font-size:14px;margin:8px 0;color:#475569}.stamp{color:#64748b;font-size:12px}.footer{margin-top:36px;color:#94a3b8;font-size:11px}</style></head><body><header><h1>${escapeHtml(property.name)}</h1><div class="stamp">PadCommand property summary · ${new Date().toLocaleDateString()}</div></header>${sections.join("")}<div class="footer">Prepared with PadCommand. Shared information was selected by the account holder.</div></body></html>`;
  };

  const handleShare = async () => {
    if (selected.size === 0) {
      Alert.alert("Choose information", "Select at least one item to include in the summary.");
      return;
    }
    try {
      setIsGenerating(true);
      const result = await Print.printToFileAsync({ html: buildHtml() });
      const summaryUri = `${FileSystem.cacheDirectory}${safeFilenamePart(property.name)} - Property Summary.pdf`;
      await FileSystem.deleteAsync(summaryUri, { idempotent: true });
      await FileSystem.copyAsync({ from: result.uri, to: summaryUri });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert("PDF created", `The summary was created at ${summaryUri}`);
        return;
      }
      await Sharing.shareAsync(summaryUri, { mimeType: "application/pdf", dialogTitle: `Share ${property.name} summary` });
    } catch (error) {
      console.error("Error generating property summary:", error);
      Alert.alert("Could not create summary", "Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Share Property Summary" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}><FileText size={26} color="#2563EB" /><View style={styles.introCopy}><Text style={styles.title}>Choose what to share</Text><Text style={styles.subtitle}>Sensitive fields start unchecked. You control every item included before the PDF is created.</Text></View></View>
        <View style={styles.summaryHeader}><Text style={styles.sectionTitle}>{property.name}</Text><Text style={styles.selectionCount}>{selected.size} selected</Text></View>
        {SUMMARY_FIELDS.map(field => {
          const active = selected.has(field.key);
          return <TouchableOpacity key={field.key} style={[styles.fieldRow, active && styles.fieldRowActive]} onPress={() => toggle(field.key)}><View style={[styles.checkbox, active && styles.checkboxActive]}>{active ? <Check size={16} color="#FFFFFF" /> : null}</View><Text style={[styles.fieldText, active && styles.fieldTextActive]}>{field.label}</Text></TouchableOpacity>;
        })}
        <View style={styles.preview}><Text style={styles.previewTitle}>Share preview</Text><Text style={styles.previewText}>A PDF will be created on this device using only the selected information. You can review the Android share sheet before sending it to a contractor, partner, email, or printer.</Text></View>
        <TouchableOpacity style={[styles.shareButton, (isGenerating || selected.size === 0) && styles.disabled]} onPress={handleShare} disabled={isGenerating || selected.size === 0}>{isGenerating ? <ActivityIndicator color="#FFFFFF" /> : <><Share2 size={19} color="#FFFFFF" /><Text style={styles.shareButtonText}>Create and share PDF</Text></>}</TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 48 },
  intro: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: "#BFDBFE", backgroundColor: "#EFF6FF", marginBottom: 20 },
  introCopy: { flex: 1 },
  title: { color: "#1E3A8A", fontSize: 21, fontWeight: "700" },
  subtitle: { color: "#475569", fontSize: 14, lineHeight: 20, marginTop: 5 },
  summaryHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { color: "#0F172A", fontSize: 19, fontWeight: "700" },
  selectionCount: { color: "#2563EB", fontSize: 13, fontWeight: "700" },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 11, borderWidth: 1, borderColor: "#E2E8F0", padding: 14, marginBottom: 9 },
  fieldRowActive: { borderColor: "#93C5FD", backgroundColor: "#F8FBFF" },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: "#CBD5E1", alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  fieldText: { flex: 1, color: "#475569", fontSize: 15 },
  fieldTextActive: { color: "#1E293B", fontWeight: "600" },
  preview: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 16, marginTop: 12, borderWidth: 1, borderColor: "#E2E8F0" },
  previewTitle: { color: "#1E293B", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  previewText: { color: "#64748B", fontSize: 13, lineHeight: 19 },
  shareButton: { minHeight: 54, backgroundColor: "#2563EB", borderRadius: 11, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18 },
  shareButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.45 },
  missing: { padding: 24, color: "#64748B" },
});
