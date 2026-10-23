// Parameter identities and choice values from the reviewed ATV11 E/U catalog.
// Manufacturer page references are in catalog-final.json and Fuentes.md.
export interface ParameterValues {
  "bFr": 50 | 60;
  "ACC": number;
  "dEC": number;
  "LSP": number;
  "HSP": number;
  "ItH": number;
  "SP2": number;
  "SP3": number;
  "SP4": number;
  "AIt.ACt": "5U" | "10U" | "0A" | "4A" | "CUS";
  "AIt.CrL": number;
  "AIt.CrH": number;
  "drC.UnS": number;
  "drC.FrS": number;
  "drC.StA": number;
  "drC.FLG": number;
  "drC.UFr": number;
  "drC.nCr": number;
  "drC.CLI": number;
  "drC.nSL": number;
  "drC.SLP": number;
  "drC.COS": number;
  "FUn.tCC.ACt": "2C" | "3C";
  "FUn.tCC.tCt": "LEL" | "trn" | "PFO";
  "FUn.rrS": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.PS2.LIA": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.PS2.LIb": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.HSP.LIA": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.HSP.LIb": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.HSP.HS2": number;
  "FUn.HSP.HS3": number;
  "FUn.HSP.HS4": number;
  "FUn.LOC": number;
  "FUn.tOL": number;
  "FUn.AP1": number;
  "FUn.LUL": number;
  "FUn.tUL": number;
  "FUn.tLS": number;
  "FUn.PI.PIF": "nO" | "AI1";
  "FUn.PI.PII": "YES";
  "FUn.PI.rPG": number;
  "FUn.PI.rIG": number;
  "FUn.PI.FbS": number;
  "FUn.PI.rPI": number;
  "FUn.PI.PIC": "nO" | "YES";
  "FUn.PI.PAU": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.PI.Pr2": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.PI.Pr4": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.PI.PI2": number;
  "FUn.PI.PI3": number;
  "FUn.PI.PI4": number;
  "FUn.PI.rSL": number;
  "FUn.rSF": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.rP2.LI": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.rP2.AC2": number;
  "FUn.rP2.dE2": number;
  "FUn.LC2.LI": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.LC2.CL2": number;
  "FUn.nSt": "nO" | "LI1" | "LI2" | "LI3" | "LI4";
  "FUn.StP": "nO" | "FrP" | "FSt";
  "FUn.brA": "nO" | "YES";
  "FUn.AdC.ACt": "nO" | "YES" | "Ct";
  "FUn.AdC.tdC": number;
  "FUn.AdC.SdC": number;
  "FUn.SFt.ACt": "LFr" | "LF" | "HF";
  "FUn.SFt.SFr": 2 | 4 | 8 | 12 | 16;
  "FUn.FLr": "nO" | "YES";
  "FUn.dO.ACt": "nO" | "OCr" | "rFr" | "FtA" | "SrA" | "CtA" | "PI";
  "FUn.dO.Ftd": number;
  "FUn.dO.Ctd": number;
  "FUn.Atr": "nO" | "YES";
  "FUn.SCS": "nO" | "YES";
  "FUn.FCS": "nO" | "rEC" | "InI";
  "SUP.COd": number;
}

export type ParameterId = keyof ParameterValues;
export type CodeValue = number | string;

export const PARAMETER_IDS = [
  "bFr",
  "ACC",
  "dEC",
  "LSP",
  "HSP",
  "ItH",
  "SP2",
  "SP3",
  "SP4",
  "AIt.ACt",
  "AIt.CrL",
  "AIt.CrH",
  "drC.UnS",
  "drC.FrS",
  "drC.StA",
  "drC.FLG",
  "drC.UFr",
  "drC.nCr",
  "drC.CLI",
  "drC.nSL",
  "drC.SLP",
  "drC.COS",
  "FUn.tCC.ACt",
  "FUn.tCC.tCt",
  "FUn.rrS",
  "FUn.PS2.LIA",
  "FUn.PS2.LIb",
  "FUn.HSP.LIA",
  "FUn.HSP.LIb",
  "FUn.HSP.HS2",
  "FUn.HSP.HS3",
  "FUn.HSP.HS4",
  "FUn.LOC",
  "FUn.tOL",
  "FUn.AP1",
  "FUn.LUL",
  "FUn.tUL",
  "FUn.tLS",
  "FUn.PI.PIF",
  "FUn.PI.PII",
  "FUn.PI.rPG",
  "FUn.PI.rIG",
  "FUn.PI.FbS",
  "FUn.PI.rPI",
  "FUn.PI.PIC",
  "FUn.PI.PAU",
  "FUn.PI.Pr2",
  "FUn.PI.Pr4",
  "FUn.PI.PI2",
  "FUn.PI.PI3",
  "FUn.PI.PI4",
  "FUn.PI.rSL",
  "FUn.rSF",
  "FUn.rP2.LI",
  "FUn.rP2.AC2",
  "FUn.rP2.dE2",
  "FUn.LC2.LI",
  "FUn.LC2.CL2",
  "FUn.nSt",
  "FUn.StP",
  "FUn.brA",
  "FUn.AdC.ACt",
  "FUn.AdC.tdC",
  "FUn.AdC.SdC",
  "FUn.SFt.ACt",
  "FUn.SFt.SFr",
  "FUn.FLr",
  "FUn.dO.ACt",
  "FUn.dO.Ftd",
  "FUn.dO.Ctd",
  "FUn.Atr",
  "FUn.SCS",
  "FUn.FCS",
  "SUP.COd",
] as const satisfies readonly ParameterId[];

export const MONITORS = ["FrH", "rFr", "LCr", "ULn", "tHr", "tHd", "HSU", "rPF"] as const;
export type MonitorCode = typeof MONITORS[number];
export type MonitorId = `SUP.${MonitorCode}`;
