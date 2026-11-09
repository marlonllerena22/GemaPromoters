import { createContext, useContext } from "react";
export const FinanceContext = createContext(null);
export const useFinance = () => useContext(FinanceContext);
