import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native'

import { Colors, Spacing } from '@/constants/theme'
import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'

export function SectionTitle({ title, detail }: { title: string; detail?: string }) {
  return <View style={styles.titleGroup}>
    <ThemedText type="subtitle">{title}</ThemedText>
    {detail ? <ThemedText themeColor="textSecondary">{detail}</ThemedText> : null}
  </View>
}

export function Card({ children }: React.PropsWithChildren) {
  return <ThemedView type="backgroundElement" style={styles.card}>{children}</ThemedView>
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline, autoCapitalize, editable = true }: {
  label: string; value: string; onChangeText: (value: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad'; multiline?: boolean; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'; editable?: boolean
}) {
  const colors = Colors.light
  return <View style={styles.fieldGroup}>
    <ThemedText type="smallBold">{label}</ThemedText>
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      keyboardType={keyboardType}
      multiline={multiline}
      editable={editable}
      autoCapitalize={autoCapitalize ?? 'sentences'}
      style={[styles.input, multiline && styles.multiline, { color: colors.text, borderColor: '#b8bbc2', backgroundColor: colors.background }]}
    />
  </View>
}

export function ActionButton({ title, onPress, disabled, busy }: { title: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, (disabled || busy) && styles.buttonDisabled, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator color="#fff" /> : <ThemedText type="smallBold" style={styles.buttonText}>{title}</ThemedText>}
  </Pressable>
}

export function Message({ children, error }: React.PropsWithChildren<{ error?: boolean }>) {
  return <ThemedText accessibilityRole={error ? 'alert' : undefined} style={error ? styles.error : styles.note}>{children}</ThemedText>
}

export function CheckRow({ title, detail, checked, onPress, disabled }: { title: string; detail?: string; checked: boolean; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked, disabled }} disabled={disabled} onPress={onPress} style={styles.checkRow}>
    <ThemedText style={styles.check}>{checked ? '☑' : '□'}</ThemedText>
    <View style={styles.checkText}><ThemedText type="smallBold">{title}</ThemedText>{detail ? <ThemedText type="small" themeColor="textSecondary">{detail}</ThemedText> : null}</View>
  </Pressable>
}

export const formStyles = StyleSheet.create({ row: { flexDirection: 'row', gap: Spacing.two }, half: { flex: 1 } })

const styles = StyleSheet.create({
  titleGroup: { gap: Spacing.two },
  card: { alignSelf: 'stretch', padding: Spacing.three, borderRadius: 18, gap: Spacing.three },
  fieldGroup: { gap: Spacing.two, flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  multiline: { minHeight: 92, textAlignVertical: 'top' },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#121212', borderRadius: 14, paddingHorizontal: Spacing.four },
  buttonDisabled: { opacity: 0.48 },
  buttonText: { color: '#fff' },
  pressed: { opacity: 0.75 },
  error: { color: '#b42318' },
  note: { lineHeight: 22 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.two },
  check: { fontSize: 22, lineHeight: 26 },
  checkText: { flex: 1, gap: Spacing.one },
})
