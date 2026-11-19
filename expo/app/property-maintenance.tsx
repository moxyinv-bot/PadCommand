import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import Papa from "papaparse";
import { CalendarDays, Check, ChevronDown, ClipboardList, DollarSign, Pencil, Plus, SlidersHorizontal, Trash2, Wrench, X } from "lucide-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaintenanceLogEntry, MaintenanceResponsibility } from "@/types/property";
import { usePortfolio } from "@/hooks/portfolio-store";
import { parseStoredDate, toStoredDate } from "@/lib/dates";

const RESPONSIBILITIES: Array<{ value: MaintenanceResponsibility; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "shared", label: "Shared" },
  { value: "other", label: "Other" },
];
const EQUIPMENT_SUGGESTIONS = ["HVAC", "Plumbing", "Electrical", "Roof", "Appliance", "Water heater", "Landscaping"];
type SortOption = "notified-newest" | "notified-oldest" | "repair-newest" | "cost-high" | "cost-low";
type DateField = "notified" | "repaired";

const emptyForm = () => ({
  issue: "",
  dateNotified: toStoredDate(new Date()),
  dateRepaired: "",
  cost: "",
  responsibility: "owner" as MaintenanceResponsibility,
  followUpNeeded: false,
  followUpDetails: "",
  equipmentTags: [] as string[],
  customEquipmentTags: "",
  notes: "",
});
const money = (amount?: number) => amount == null ? "Not recorded" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
const displayDate = (date?: string) => date ? parseStoredDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Not recorded";

export default function PropertyMaintenanceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { properties, maintenanceLogs, addMaintenanceLog, updateMaintenanceLog, deleteMaintenanceLog } = usePortfolio();
  const property = properties.find(item => item.id === id);
  const [sortOption, setSortOption] = useState<SortOption>("notified-newest");
  const [showSortOptions, setShowSortOptions] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [datePicker, setDatePicker] = useState<DateField | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const propertyLogs = useMemo(() => {
    const records = maintenanceLogs.filter(entry => entry.propertyId === id);
    return records.sort((a, b) => {
      if (sortOption === "notified-oldest") return a.dateNotified.localeCompare(b.dateNotified);
      if (sortOption === "repair-newest") return (b.dateRepaired || "").localeCompare(a.dateRepaired || "");
      if (sortOption === "cost-high") return (b.cost ?? -1) - (a.cost ?? -1);
      if (sortOption === "cost-low") return (a.cost ?? Number.MAX_SAFE_INTEGER) - (b.cost ?? Number.MAX_SAFE_INTEGER);
      return b.dateNotified.localeCompare(a.dateNotified);
    });
  }, [maintenanceLogs, id, sortOption]);

  if (!property) return <SafeAreaView style={styles.container}><Text style={styles.emptyTitle}>Property not found.</Text></SafeAreaView>;

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowEditor(true);
  };

  const openEdit = (entry: MaintenanceLogEntry) => {
    setEditingId(entry.id);
    setForm({
      issue: entry.issue,
      dateNotified: entry.dateNotified,
      dateRepaired: entry.dateRepaired || "",
      cost: entry.cost == null ? "" : String(entry.cost),
      responsibility: entry.responsibility,
      followUpNeeded: entry.followUpNeeded,
      followUpDetails: entry.followUpDetails || "",
      equipmentTags: [...entry.equipmentTags],
      customEquipmentTags: entry.equipmentTags.filter(tag => !EQUIPMENT_SUGGESTIONS.includes(tag)).join(", "),
      notes: entry.notes || "",
    });
    setShowEditor(true);
  };

  const toggleTag = (tag: string) => {
    setForm(current => ({
      ...current,
      equipmentTags: current.equipmentTags.includes(tag)
        ? current.equipmentTags.filter(item => item !== tag)
        : [...current.equipmentTags, tag],
    }));
  };

  const saveEntry = async () => {
    if (!form.issue.trim()) {
      Alert.alert("Issue required", "Describe the maintenance issue before saving.");
      return;
    }
    if (!form.dateNotified || Number.isNaN(parseStoredDate(form.dateNotified).getTime())) {
      Alert.alert("Notification date required", "Enter a valid date you were notified.");
      return;
    }
    if (form.dateRepaired) {
      const notifiedTime = parseStoredDate(form.dateNotified).getTime();
      const repairedTime = parseStoredDate(form.dateRepaired).getTime();
      if (Number.isNaN(repairedTime) || repairedTime < notifiedTime) {
        Alert.alert("Invalid repair date", "The repair date must be valid and cannot be before the notification date.");
        return;
      }
    }
    const parsedCost = form.cost.trim() ? Number(form.cost.replace(/[$,\s]/g, "")) : undefined;
    if (form.cost.trim() && (!Number.isFinite(parsedCost) || (parsedCost ?? -1) < 0)) {
      Alert.alert("Invalid cost", "Enter a valid non-negative repair cost.");
      return;
    }

    const values = {
      propertyId: property.id,
      issue: form.issue.trim(),
      dateNotified: form.dateNotified,
      dateRepaired: form.dateRepaired || undefined,
      cost: parsedCost,
      responsibility: form.responsibility,
      followUpNeeded: form.followUpNeeded,
      followUpDetails: form.followUpNeeded ? form.followUpDetails.trim() || undefined : undefined,
      equipmentTags: Array.from(new Set([
        ...form.equipmentTags.filter(tag => EQUIPMENT_SUGGESTIONS.includes(tag)),
        ...form.customEquipmentTags.split(",").map(tag => tag.trim()).filter(Boolean),
      ])),
      notes: form.notes.trim() || undefined,
    };

    try {
      setIsSaving(true);
      if (editingId) {
        await updateMaintenanceLog(editingId, values);
      } else {
        const now = new Date().toISOString();
        await addMaintenanceLog({
          id: `maintenance_${Date.now()}`,
          ...values,
          createdAt: now,
          updatedAt: now,
        });
      }
      setShowEditor(false);
    } catch (error) {
      console.error("Maintenance entry save failed:", error);
      Alert.alert("Could not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = (entry: MaintenanceLogEntry) => {
    Alert.alert("Delete maintenance entry?", `Delete “${entry.issue}”?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await deleteMaintenanceLog(entry.id);
        } catch (error) {
          Alert.alert("Could not delete", error instanceof Error ? error.message : "Please try again.");
        }
      } },
    ]);
  };

  const exportCsv = async () => {
    if (propertyLogs.length === 0) {
      Alert.alert("Nothing to export", "Add a maintenance entry before exporting the log.");
      return;
    }
    try {
      setIsExporting(true);
      const csv = Papa.unparse(propertyLogs.map(entry => ({
        "Property Name": property.name,
        Address: property.address,
        Issue: entry.issue,
        "Date Notified": entry.dateNotified,
        "Date Repaired": entry.dateRepaired || "",
        "Repair Cost": entry.cost ?? "",
        "Responsible Party": entry.responsibility,
        "Follow-up Needed": entry.followUpNeeded ? "Yes" : "No",
        "Follow-up Details": entry.followUpDetails || "",
        "Equipment Tags": entry.equipmentTags.join("; "),
        Notes: entry.notes || "",
      })));
      const safeName = property.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ").trim().replace(/\s+/g, "_") || "Property";
      const filename = `${safeName}_Maintenance_Log_${new Date().toISOString().slice(0, 10)}.csv`;
      const uri = `${FileSystem.cacheDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: "text/csv", dialogTitle: `Export ${property.name} maintenance log` });
      } else {
        Alert.alert("CSV created", `Saved at ${uri}`);
      }
    } catch (error) {
      console.error("Maintenance CSV export failed:", error);
      Alert.alert("Export failed", "Could not create the maintenance CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const sortLabel: Record<SortOption, string> = {
    "notified-newest": "Notification: newest",
    "notified-oldest": "Notification: oldest",
    "repair-newest": "Repair date: newest",
    "cost-high": "Cost: high to low",
    "cost-low": "Cost: low to high",
  };

  const pickerSource = datePicker === "repaired" && form.dateRepaired ? form.dateRepaired : form.dateNotified;
  const parsedPickerDate = pickerSource ? parseStoredDate(pickerSource) : new Date();
  const pickerDate = Number.isNaN(parsedPickerDate.getTime()) ? new Date() : parsedPickerDate;

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Stack.Screen options={{ title: "Maintenance Log" }} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.pageHeader}>
          <View style={styles.headingGroup}><Wrench size={23} color="#2563EB" /><View style={styles.headingText}><Text style={styles.title}>Maintenance Log</Text><Text style={styles.subtitle}>{property.name} · {property.address}</Text></View></View>
          <TouchableOpacity style={styles.addButton} onPress={openNew}><Plus size={18} color="#FFFFFF" /><Text style={styles.addButtonText}>Add</Text></TouchableOpacity>
        </View>

        <View style={styles.toolbar}>
          <TouchableOpacity style={styles.sortButton} onPress={() => setShowSortOptions(true)}><SlidersHorizontal size={16} color="#2563EB" /><Text style={styles.sortText}>{sortLabel[sortOption]}</Text><ChevronDown size={15} color="#64748B" /></TouchableOpacity>
          <TouchableOpacity style={styles.exportButton} onPress={exportCsv} disabled={isExporting}>{isExporting ? <ActivityIndicator size="small" color="#2563EB" /> : <><DollarSign size={15} color="#2563EB" /><Text style={styles.exportText}>Export CSV</Text></>}</TouchableOpacity>
        </View>

        {propertyLogs.length === 0 ? (
          <View style={styles.empty}><ClipboardList size={44} color="#94A3B8" /><Text style={styles.emptyTitle}>No maintenance logged yet</Text><Text style={styles.emptySubtitle}>Record service calls, repairs, responsibility, costs, and follow-up for this property.</Text><TouchableOpacity style={styles.emptyAdd} onPress={openNew}><Plus size={17} color="#FFFFFF" /><Text style={styles.addButtonText}>Log maintenance</Text></TouchableOpacity></View>
        ) : propertyLogs.map(entry => (
          <View key={entry.id} style={styles.entryCard}>
            <View style={styles.entryTop}><View style={styles.entryIssueWrap}><Text style={styles.entryIssue}>{entry.issue}</Text><Text style={styles.entryDate}>Notified {displayDate(entry.dateNotified)}{entry.dateRepaired ? ` · Repaired ${displayDate(entry.dateRepaired)}` : " · Repair pending"}</Text></View><View style={styles.rowActions}><TouchableOpacity onPress={() => openEdit(entry)} hitSlop={8}><Pencil size={17} color="#2563EB" /></TouchableOpacity><TouchableOpacity onPress={() => confirmDelete(entry)} hitSlop={8}><Trash2 size={17} color="#DC2626" /></TouchableOpacity></View></View>
            <View style={styles.chipRow}><Text style={styles.partyChip}>{entry.responsibility === "owner" ? "Owner responsibility" : entry.responsibility === "tenant" ? "Tenant responsibility" : entry.responsibility === "shared" ? "Shared responsibility" : "Other responsibility"}</Text><Text style={styles.cost}>{money(entry.cost)}</Text></View>
            {entry.equipmentTags.length > 0 && <View style={styles.tags}>{entry.equipmentTags.map(tag => <Text style={styles.tag} key={tag}>{tag}</Text>)}</View>}
            {entry.followUpNeeded && <View style={styles.followUp}><Text style={styles.followUpLabel}>Follow-up needed</Text>{entry.followUpDetails ? <Text style={styles.bodyText}>{entry.followUpDetails}</Text> : null}</View>}
            {entry.notes ? <Text style={styles.notes}>{entry.notes}</Text> : null}
          </View>
        ))}
      </ScrollView>

      <Modal visible={showEditor} animationType="slide" onRequestClose={() => setShowEditor(false)}>
        <SafeAreaView style={styles.modalSafe} edges={["top", "bottom"]}>
          <KeyboardAvoidingView style={styles.modalRoot} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.modalHeader}><TouchableOpacity onPress={() => setShowEditor(false)}><X size={23} color="#64748B" /></TouchableOpacity><Text style={styles.modalTitle}>{editingId ? "Edit Maintenance" : "Add Maintenance"}</Text><View style={{ width: 24 }} /></View>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Issue / service call *</Text>
              <TextInput style={styles.input} value={form.issue} onChangeText={issue => setForm(current => ({ ...current, issue }))} placeholder="e.g. AC not cooling in upstairs unit" />

              <Text style={styles.label}>Date notified *</Text>
              <TouchableOpacity style={styles.dateButton} onPress={() => setDatePicker("notified")}><CalendarDays size={17} color="#2563EB" /><Text style={styles.dateText}>{displayDate(form.dateNotified)}</Text></TouchableOpacity>

              <Text style={styles.label}>Date repaired</Text>
              <View style={styles.dateLine}><TouchableOpacity style={[styles.dateButton, styles.dateFlex]} onPress={() => setDatePicker("repaired")}><CalendarDays size={17} color="#2563EB" /><Text style={styles.dateText}>{form.dateRepaired ? displayDate(form.dateRepaired) : "Select repair date"}</Text></TouchableOpacity>{form.dateRepaired ? <TouchableOpacity onPress={() => setForm(current => ({ ...current, dateRepaired: "" }))}><X size={18} color="#64748B" /></TouchableOpacity> : null}</View>

              <Text style={styles.label}>Cost to repair</Text>
              <TextInput style={styles.input} value={form.cost} onChangeText={cost => setForm(current => ({ ...current, cost }))} placeholder="0.00" keyboardType="decimal-pad" />

              <Text style={styles.label}>Responsible party</Text>
              <View style={styles.segmentRow}>{RESPONSIBILITIES.map(option => <TouchableOpacity key={option.value} style={[styles.segment, form.responsibility === option.value && styles.segmentActive]} onPress={() => setForm(current => ({ ...current, responsibility: option.value }))}><Text style={[styles.segmentText, form.responsibility === option.value && styles.segmentTextActive]}>{option.label}</Text></TouchableOpacity>)}</View>

              <Text style={styles.label}>Equipment tags</Text>
              <View style={styles.suggestionRow}>{EQUIPMENT_SUGGESTIONS.map(tag => <TouchableOpacity key={tag} style={[styles.suggestion, form.equipmentTags.includes(tag) && styles.suggestionActive]} onPress={() => toggleTag(tag)}><Text style={[styles.suggestionText, form.equipmentTags.includes(tag) && styles.suggestionTextActive]}>{tag}</Text></TouchableOpacity>)}</View>
              <TextInput style={styles.input} value={form.customEquipmentTags} onChangeText={customEquipmentTags => setForm(current => ({ ...current, customEquipmentTags }))} placeholder="Other tags, separated by commas" />

              <TouchableOpacity style={styles.followToggle} onPress={() => setForm(current => ({ ...current, followUpNeeded: !current.followUpNeeded }))}><View style={[styles.checkbox, form.followUpNeeded && styles.checkboxActive]}>{form.followUpNeeded ? <Check size={14} color="#FFFFFF" /> : null}</View><Text style={styles.toggleText}>Follow-up needed</Text></TouchableOpacity>
              {form.followUpNeeded && <TextInput style={[styles.input, styles.multiline]} value={form.followUpDetails} onChangeText={followUpDetails => setForm(current => ({ ...current, followUpDetails }))} placeholder="What still needs to happen?" multiline textAlignVertical="top" />}

              <Text style={styles.label}>Notes</Text>
              <TextInput style={[styles.input, styles.multiline]} value={form.notes} onChangeText={notes => setForm(current => ({ ...current, notes }))} placeholder="Additional context, vendor, outcome..." multiline textAlignVertical="top" />
            </ScrollView>
            <View style={styles.modalFooter}><TouchableOpacity style={styles.cancelButton} onPress={() => setShowEditor(false)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity><TouchableOpacity style={[styles.saveButton, isSaving && styles.disabled]} onPress={saveEntry} disabled={isSaving}>{isSaving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.saveText}>{editingId ? "Save Changes" : "Save Entry"}</Text>}</TouchableOpacity></View>
          </KeyboardAvoidingView>
          {datePicker ? (
            <View style={Platform.OS === "ios" ? styles.datePickerPanel : undefined}>
              <DateTimePicker
                value={pickerDate}
                mode="date"
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(event, chosenDate) => {
                  const field = datePicker;
                  if (Platform.OS !== "ios") setDatePicker(null);
                  if (event.type === "set" && chosenDate) {
                    setForm(current => field === "notified"
                      ? { ...current, dateNotified: toStoredDate(chosenDate) }
                      : { ...current, dateRepaired: toStoredDate(chosenDate) });
                  }
                }}
              />
              {Platform.OS === "ios" ? (
                <View style={styles.datePickerActions}>
                  <TouchableOpacity onPress={() => setDatePicker(null)}><Text style={styles.datePickerCancel}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setDatePicker(null)}><Text style={styles.datePickerDone}>Done</Text></TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}
        </SafeAreaView>
      </Modal>

      <Modal visible={showSortOptions} transparent animationType="fade" onRequestClose={() => setShowSortOptions(false)}>
        <TouchableOpacity style={styles.sortBackdrop} activeOpacity={1} onPress={() => setShowSortOptions(false)}><View style={styles.sortMenu}><Text style={styles.modalTitle}>Sort maintenance log</Text>{(Object.keys(sortLabel) as SortOption[]).map(option => <TouchableOpacity key={option} style={styles.sortOption} onPress={() => { setSortOption(option); setShowSortOptions(false); }}><Text style={[styles.sortOptionText, option === sortOption && styles.sortOptionTextActive]}>{sortLabel[option]}</Text>{option === sortOption ? <Check size={17} color="#2563EB" /> : null}</TouchableOpacity>)}</View></TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, paddingBottom: 40 },
  pageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 },
  headingGroup: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headingText: { flex: 1 },
  title: { color: "#0F172A", fontSize: 20, fontWeight: "700" },
  subtitle: { color: "#64748B", fontSize: 12, marginTop: 3 },
  addButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#2563EB", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  addButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  toolbar: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginBottom: 14 },
  sortButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, minHeight: 42, borderColor: "#BFDBFE", borderWidth: 1, backgroundColor: "#FFFFFF", borderRadius: 9, paddingHorizontal: 10 },
  sortText: { color: "#334155", fontSize: 12, flex: 1 },
  exportButton: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 42, borderColor: "#BFDBFE", borderWidth: 1, backgroundColor: "#FFFFFF", borderRadius: 9, paddingHorizontal: 11 },
  exportText: { color: "#2563EB", fontSize: 13, fontWeight: "700" },
  empty: { alignItems: "center", padding: 30, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 13, marginTop: 20 },
  emptyTitle: { color: "#1E293B", fontSize: 17, fontWeight: "700", marginTop: 12 },
  emptySubtitle: { color: "#64748B", fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 5, marginBottom: 17 },
  emptyAdd: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#2563EB", borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },
  entryCard: { backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 12, padding: 14, marginBottom: 10 },
  entryTop: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  entryIssueWrap: { flex: 1 },
  entryIssue: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  entryDate: { color: "#64748B", fontSize: 12, marginTop: 5 },
  rowActions: { flexDirection: "row", gap: 14, paddingTop: 2 },
  chipRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 11 },
  partyChip: { color: "#1D4ED8", backgroundColor: "#EFF6FF", overflow: "hidden", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, fontSize: 12, fontWeight: "600" },
  cost: { color: "#0F172A", fontSize: 15, fontWeight: "700" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  tag: { color: "#475569", backgroundColor: "#F1F5F9", overflow: "hidden", borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11 },
  followUp: { borderLeftWidth: 3, borderLeftColor: "#F59E0B", paddingLeft: 9, marginTop: 10 },
  followUpLabel: { color: "#92400E", fontSize: 12, fontWeight: "700" },
  bodyText: { color: "#475569", fontSize: 13, marginTop: 3 },
  notes: { color: "#475569", fontSize: 13, lineHeight: 19, marginTop: 10 },
  modalSafe: { flex: 1, backgroundColor: "#F8FAFC" },
  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E2E8F0", backgroundColor: "#FFFFFF" },
  modalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "700" },
  form: { padding: 16, paddingBottom: 24 },
  label: { color: "#334155", fontSize: 14, fontWeight: "600", marginBottom: 7, marginTop: 14 },
  input: { minHeight: 46, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 9, backgroundColor: "#FFFFFF", paddingHorizontal: 12, paddingVertical: 10, color: "#0F172A", fontSize: 15 },
  multiline: { minHeight: 85, textAlignVertical: "top" },
  dateButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 9, backgroundColor: "#FFFFFF" },
  dateLine: { flexDirection: "row", alignItems: "center", gap: 10 },
  dateFlex: { flex: 1 },
  dateText: { color: "#334155", fontSize: 14 },
  datePickerPanel: { backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#E2E8F0" },
  datePickerActions: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, paddingVertical: 12 },
  datePickerCancel: { color: "#64748B", fontWeight: "600" },
  datePickerDone: { color: "#2563EB", fontWeight: "700" },
  segmentRow: { flexDirection: "row", gap: 6 },
  segment: { flex: 1, minHeight: 39, borderRadius: 8, borderWidth: 1, borderColor: "#CBD5E1", backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  segmentActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  segmentText: { color: "#64748B", fontSize: 12, fontWeight: "600" },
  segmentTextActive: { color: "#1D4ED8" },
  suggestionRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  suggestion: { borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 16, backgroundColor: "#FFFFFF", paddingHorizontal: 9, paddingVertical: 6 },
  suggestionActive: { borderColor: "#2563EB", backgroundColor: "#EFF6FF" },
  suggestionText: { color: "#64748B", fontSize: 12 },
  suggestionTextActive: { color: "#1D4ED8", fontWeight: "600" },
  followToggle: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 17 },
  checkbox: { width: 22, height: 22, borderWidth: 2, borderColor: "#94A3B8", borderRadius: 5, alignItems: "center", justifyContent: "center" },
  checkboxActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  toggleText: { color: "#334155", fontSize: 14, fontWeight: "600" },
  modalFooter: { flexDirection: "row", gap: 10, padding: 14, borderTopWidth: 1, borderTopColor: "#E2E8F0", backgroundColor: "#FFFFFF" },
  cancelButton: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 9, alignItems: "center", justifyContent: "center" },
  cancelText: { color: "#475569", fontWeight: "700" },
  saveButton: { flex: 1.5, minHeight: 48, backgroundColor: "#2563EB", borderRadius: 9, alignItems: "center", justifyContent: "center" },
  saveText: { color: "#FFFFFF", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  sortBackdrop: { flex: 1, backgroundColor: "rgba(15,23,42,.4)", justifyContent: "center", padding: 24 },
  sortMenu: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16 },
  sortOption: { minHeight: 45, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#F1F5F9" },
  sortOptionText: { color: "#475569", fontSize: 14 },
  sortOptionTextActive: { color: "#2563EB", fontWeight: "700" },
});
