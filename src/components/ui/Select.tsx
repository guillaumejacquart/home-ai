import type { SelectHTMLAttributes } from "react";
import { fieldStyles } from "./field-styles";

export function Select({
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={fieldStyles(className)} {...props} />;
}