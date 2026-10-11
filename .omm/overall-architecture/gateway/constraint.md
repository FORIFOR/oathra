packages / providers の src を直接 import してはいけない（dist のみ）。sdk と plugins 以外の上位を import しない（scripts/check-deps.mjs）。
