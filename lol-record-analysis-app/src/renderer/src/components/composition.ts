


// composition.ts
import { useMessage } from "naive-ui";

export const useCopy = () => {
  const message = useMessage();
  
  const copy = (nameId: string) => {
    navigator.clipboard.writeText(nameId)
      .then(() => {
        message.success("复制成功");
      })
      .catch(() => {
        message.error("复制失败");
      });
  }
  
  return { copy };
}