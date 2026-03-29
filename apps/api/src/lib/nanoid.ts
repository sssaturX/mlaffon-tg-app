import { customAlphabet } from "nanoid";

const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const referralCode = customAlphabet(alphabet, 10);
