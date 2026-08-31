import type { InputHTMLAttributes, Ref } from "react";
import { fieldStyles } from "./field-styles";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input className={fieldStyles(className)} {...props} />;
}
