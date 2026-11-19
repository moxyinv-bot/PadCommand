import React, { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Stack, router } from "expo-router";
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Transaction } from "@/types/property";
import { usePortfolio } from "@/hooks/portfolio-store";
import { parseTransactionCsv, transactionCsvTemplate, transactionsToCsv, TransactionImportResult } from "@/lib/transaction-csv";

export default function TransactionImportScreen() {
  const { properties, transactions, addTransaction } = usePortfolio();
  const [result, setResult] = useState<TransactionImportResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const shareCsv = async (content: string, name: string) => {
    const uri = `${FileSystem.cacheDirectory}${name}`;
    await FileSystem.writeAsStringAsync(uri, content, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: "Save or share CSV" });
    } else {
      Alert.alert("File ready", `CSV created at ${uri}`);
    }
  };

  const handleChooseFile = async () => {
    try {
      setIsReading(true);
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      const csv = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.UTF8 });
      setFileName(asset.name || "Selected CSV");
      setResult(parseTransactionCsv(csv, properties, transactions));
    } catch (error) {
      console.error("Error reading transaction CSV:", error);
      Alert.alert("Could not read file", "Choose a CSV exported from Excel or use the PadCommand template.");
    } finally {
      setIsReading(false);
    }
  };

  const handleImport = () => {
    if (!result || result.valid.length === 0 || isImporting) return;
    Alert.alert(
      "Import transactions?",
      `${result.valid.length} transaction${result.valid.length === 1 ? "" : "s"} will be added. Unmatched, invalid, and duplicate rows will be skipped.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Import",
          onPress: async () => {
            try {
              setIsImporting(true);
              for (const item of result.valid) {
                const transaction: Transaction = {
                  id: `transaction_import_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                  propertyId: item.propertyId,
                  type: item.type,
                  category: item.category,
                  amount: item.amount,
                  date: item.date,
                  description: item.description,
                  tags: item.tags,
                  receiptName: item.receiptName,
                };
                await addTransaction(transaction);
              }
              Alert.alert("Import complete", `${result.valid.length} transaction${result.valid.length === 1 ? "" : "s"} added.`, [{ text: "Done", onPress: () => router.back() }]);
            } catch (error) {
              console.error("Error importing transactions:", error);
              Alert.alert("Import stopped", "Some rows may have been added. Review your finances before trying again.");
            } finally {
              setIsImporting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Import Transactions" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <FileSpreadsheet size={28} color="#2563EB" />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Bring in your ledger</Text>
            <Text style={styles.subtitle}>Match every row to an existing PadCommand property before anything is saved.</Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => shareCsv(transactionCsvTemplate(), "padcommand-transaction-template.csv")}>
            <Download size={18} color="#2563EB" /><Text style={styles.secondaryButtonText}>Download template</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => shareCsv(transactionsToCsv(transactions, properties), `padcommand-transactions-${new Date().toISOString().slice(0, 10)}.csv`)}>
            <Download size={18} color="#2563EB" /><Text style={styles.secondaryButtonText}>Export transactions</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.chooseButton} onPress={handleChooseFile} disabled={isReading}>
          {isReading ? <ActivityIndicator color="#FFFFFF" /> : <Upload size={20} color="#FFFFFF" />}
          <Text style={styles.chooseButtonText}>{isReading ? "Reading CSV..." : "Choose CSV file"}</Text>
        </TouchableOpacity>
        <Text style={styles.helperText}>Required columns: Property Name, Property Address, Transaction Type, Date, and Amount. Save Excel files as CSV before importing.</Text>
        {fileName ? <Text style={styles.fileName}>Selected: {fileName}</Text> : null}

        {result ? (
          <View style={styles.previewCard}>
            <Text style={styles.sectionTitle}>Import preview</Text>
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}><Text style={styles.summaryNumber}>{result.valid.length}</Text><Text style={styles.summaryLabel}>Ready</Text></View>
              <View style={styles.summaryItem}><Text style={[styles.summaryNumber, styles.warningNumber]}>{result.duplicates.length}</Text><Text style={styles.summaryLabel}>Duplicates</Text></View>
              <View style={styles.summaryItem}><Text style={[styles.summaryNumber, styles.errorNumber]}>{result.errors.length}</Text><Text style={styles.summaryLabel}>Needs correction</Text></View>
            </View>
            {result.valid.slice(0, 5).map((item, index) => (
              <View style={styles.previewRow} key={`${item.description}-${item.date}-${index}`}>
                <CheckCircle2 size={18} color="#10B981" />
                <View style={styles.previewCopy}><Text style={styles.previewName}>{item.description}</Text><Text style={styles.previewAddress}>{item.propertyName} · {item.date} · ${item.amount.toFixed(2)}</Text></View>
              </View>
            ))}
            {result.valid.length > 5 ? <Text style={styles.moreText}>and {result.valid.length - 5} more ready to import</Text> : null}
            {result.duplicates.length > 0 ? <View style={styles.issueBlock}><Text style={styles.issueTitle}>Skipped duplicates</Text>{result.duplicates.slice(0, 4).map(item => <Text style={styles.issueText} key={item}>{item}</Text>)}</View> : null}
            {result.errors.length > 0 ? <View style={styles.issueBlock}><Text style={styles.issueTitle}>Rows needing correction</Text>{result.errors.slice(0, 5).map(item => <Text style={styles.issueText} key={item}>{item}</Text>)}</View> : null}
            <TouchableOpacity style={[styles.importButton, (result.valid.length === 0 || isImporting) && styles.disabledButton]} onPress={handleImport} disabled={result.valid.length === 0 || isImporting}>
              {isImporting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.importButtonText}>Import {result.valid.length} transaction{result.valid.length === 1 ? "" : "s"}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearButton} onPress={() => { setResult(null); setFileName(""); }}><XCircle size={16} color="#64748B" /><Text style={styles.clearButtonText}>Clear preview</Text></TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 20, paddingBottom: 48 },
  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 16 },
  headerCopy: { flex: 1 },
  title: { color: "#1E3A8A", fontSize: 21, fontWeight: "700" },
  subtitle: { color: "#475569", fontSize: 14, lineHeight: 20, marginTop: 5 },
  actions: { flexDirection: "row", gap: 10, marginBottom: 12 },
  secondaryButton: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: "#BFDBFE", backgroundColor: "#FFFFFF", borderRadius: 10, paddingHorizontal: 10 },
  secondaryButtonText: { color: "#2563EB", fontSize: 13, fontWeight: "700" },
  chooseButton: { minHeight: 54, borderRadius: 11, backgroundColor: "#2563EB", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  chooseButtonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  helperText: { color: "#64748B", fontSize: 13, lineHeight: 19, marginTop: 10 },
  fileName: { color: "#334155", fontSize: 14, fontWeight: "600", marginTop: 14 },
  previewCard: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 20 },
  sectionTitle: { color: "#0F172A", fontSize: 19, fontWeight: "700", marginBottom: 14 },
  summaryGrid: { flexDirection: "row", gap: 8, marginBottom: 16 },
  summaryItem: { flex: 1, backgroundColor: "#F8FAFC", borderRadius: 9, padding: 10, alignItems: "center" },
  summaryNumber: { color: "#10B981", fontSize: 24, fontWeight: "800" },
  warningNumber: { color: "#D97706" },
  errorNumber: { color: "#DC2626" },
  summaryLabel: { color: "#64748B", fontSize: 11, textAlign: "center", marginTop: 2 },
  previewRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
  previewCopy: { flex: 1 },
  previewName: { color: "#1E293B", fontSize: 15, fontWeight: "700" },
  previewAddress: { color: "#64748B", fontSize: 13, marginTop: 2 },
  moreText: { color: "#64748B", fontSize: 13, marginTop: 5 },
  issueBlock: { backgroundColor: "#FFF7ED", borderRadius: 9, padding: 12, marginTop: 14 },
  issueTitle: { color: "#9A3412", fontSize: 14, fontWeight: "700", marginBottom: 5 },
  issueText: { color: "#7C2D12", fontSize: 12, lineHeight: 18 },
  importButton: { backgroundColor: "#10B981", borderRadius: 10, minHeight: 50, alignItems: "center", justifyContent: "center", marginTop: 18 },
  importButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  disabledButton: { opacity: 0.45 },
  clearButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  clearButtonText: { color: "#64748B", fontSize: 13, fontWeight: "600" },
});
