/** Keep private response bytes tied to the original authorization, including a
 * storage read already waiting when the owner locks reviews. Never buffer files. */
export function guardedReviewBody(body:ReadableStream<Uint8Array>,authorized:()=>Promise<boolean>):ReadableStream<Uint8Array> {
  const reader=body.getReader()
  let released=false
  async function cleanup(reason?:unknown) {
    if(released)return
    released=true
    try{await reader.cancel(reason)}finally{reader.releaseLock()}
  }
  async function check() {
    if(!await authorized())throw new Error('Review access ended')
  }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        await check()
        const next=await reader.read()
        await check()
        if(next.done){released=true;reader.releaseLock();controller.close()}
        else controller.enqueue(next.value)
      }catch(error){
        await cleanup(error).catch(()=>{})
        controller.error(error)
      }
    },
    cancel:cleanup,
  },{highWaterMark:0})
}
