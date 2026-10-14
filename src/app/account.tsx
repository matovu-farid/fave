import { router } from 'expo-router'

import AccountScreen from '@/components/account-screen'

export default function AccountRoute() {
  return <AccountScreen onClose={() => router.replace('/')} />
}
