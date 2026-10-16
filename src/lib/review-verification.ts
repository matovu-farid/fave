const webOnly=async()=>{throw new Error('Open the staff console in your browser to set up or verify staff access.')}
export const enrollReviewPasskey=webOnly
export const verifyReviewPasskey=webOnly
export const enrollReviewAuthenticator=async():Promise<{totpURI:string}|null>=>webOnly()
export const verifyReviewAuthenticator=async(_code:string)=>webOnly()
