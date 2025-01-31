import { useMessage } from "naive-ui";

const message = useMessage();
export const copy = (nameId) => {
    navigator.clipboard.writeText(nameId)
        .then(() => {
            message.success("复制成功");
        })
        .catch(() => {
            message.error("复制失败");
        });
}