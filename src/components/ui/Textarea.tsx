import type { TextareaHTMLAttributes } from "react";
import { fieldStyles } from "./field-styles";

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={fieldStyles(className)} {...props} />;
}