import ReviewFrame from '@/components/staff-review/review-frame'
import SecurityPanel,{useReviewSecurity} from '@/components/staff-review/security-panel'
export default function StaffSecurity(){const access=useReviewSecurity();return <ReviewFrame title="Staff security"><SecurityPanel state={access} manage/></ReviewFrame>}
