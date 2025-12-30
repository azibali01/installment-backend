export type RoundingPolicy = "nearest" | "up" | "down";
export type InterestModel = "amortized" | "flat" | "equal";

function applyRounding(value: number, policy: RoundingPolicy) {
    switch (policy) {
        case "up":
            return Math.ceil(value * 100) / 100;
        case "down":
            return Math.floor(value * 100) / 100;
        default:
            return Math.round(value * 100) / 100;
    }
}

export function amortizedMonthlyPayment(principal: number, annualRate: number, months: number) {
    if (!principal || months <= 0) return 0;
    const r = (annualRate || 0) / 100 / 12;
    if (r === 0) return principal / months;
    const pow = Math.pow(1 + r, months);
    return (principal * r * pow) / (pow - 1);
}

export function generateSchedule(
    principal: number,
    annualRate: number,
    months: number,
    startDate?: Date,
    rounding: RoundingPolicy = "nearest",
    model: InterestModel = "equal",
) {
    const schedule: Array<any> = [];
    if (months <= 0 || principal <= 0) return schedule;

    const start = startDate ? new Date(startDate) : new Date();
    start.setHours(0, 0, 0, 0);

    if (model === "flat") {
        const totalWithInterest = principal * (1 + ((annualRate || 0) / 100) * (months / 12));
        const monthly = totalWithInterest / months;
        for (let i = 0; i < months; i++) {
            const due = new Date(start.getFullYear(), start.getMonth() + i + 1, start.getDate());
            schedule.push({ month: i + 1, dueDate: due, amount: applyRounding(monthly, rounding) });
        }
        return schedule;
    }

    if (model === "equal") {
        const monthly = principal / months;
        for (let i = 0; i < months; i++) {
            const due = new Date(start.getFullYear(), start.getMonth() + i + 1, start.getDate());
            const principalR = applyRounding(monthly, rounding);
            const amount = principalR; // no interest
            const balance = Math.max(0, Number((principal - monthly * (i + 1)).toFixed(2)));
            schedule.push({ month: i + 1, dueDate: due, amount, principal: principalR, interest: 0, balance });
        }
        return schedule;
    }

    const monthlyNominal = amortizedMonthlyPayment(principal, annualRate, months);
    let balance = principal;
    const r = (annualRate || 0) / 100 / 12;

    for (let i = 0; i < months; i++) {
        const interest = r === 0 ? 0 : balance * r;
        let principalPortion = monthlyNominal - interest;
        if (i === months - 1) {
            principalPortion = balance;
        }
        const interestR = applyRounding(interest, rounding);
        const principalR = applyRounding(principalPortion, rounding);
        let amount = applyRounding(interestR + principalR, rounding);
        if (i === months - 1) {
            amount = applyRounding(balance + interest, rounding);
        }
        const due = new Date(start.getFullYear(), start.getMonth() + i + 1, start.getDate());
        schedule.push({ month: i + 1, dueDate: due, amount, principal: principalR, interest: interestR });
        balance = Math.max(0, balance - principalPortion);
    }

    return schedule;
}

export function allocatePaymentToSchedule(
    schedule: Array<any>,
    model: InterestModel,
    amount: number,
    rounding: RoundingPolicy = "nearest",
) {
    const allocation = {
        total: amount,
        appliedToMonths: [] as Array<{ month: number; applied: number; remainingForMonth: number }>,
        breakdown: { principal: 0, interest: 0, fees: 0 },
    }

    let remaining = amount;
    for (let i = 0; i < schedule.length && remaining > 0; i++) {
        const entry = schedule[i];
        const due = Number(entry.amount || 0);
        const paid = Number(entry.paidAmount || 0);
        const outstanding = Math.max(0, due - paid);
        if (outstanding <= 0) continue;

        const applied = Math.min(outstanding, remaining);
        remaining = remaining - applied;

        if (model === "equal") {
            allocation.breakdown.principal += applied;
        } else {
            const interestPart = Number(entry.interest || 0);
            const principalPart = Math.max(0, due - interestPart);
            const ratio = outstanding > 0 ? applied / outstanding : 0;
            const appliedInterest = applyRounding(interestPart * ratio, rounding);
            const appliedPrincipal = applyRounding(applied - appliedInterest, rounding);
            allocation.breakdown.interest += appliedInterest;
            allocation.breakdown.principal += appliedPrincipal;
        }

        allocation.appliedToMonths.push({ month: entry.month, applied, remainingForMonth: Math.max(0, outstanding - applied) });
    }

    if (remaining > 0) {
        allocation.breakdown.principal += remaining;
        allocation.appliedToMonths.push({ month: -1, applied: remaining, remainingForMonth: 0 });
        remaining = 0;
    }

    return allocation;
}

/**
 * Calculate remaining balance from installment schedule
 * This is the source of truth for remaining balance calculation
 * 
 * IMPORTANT: This calculates ONLY unpaid installments from the schedule.
 * Down payment is NOT included because:
 * 1. Down payment is paid upfront when plan is created
 * 2. Schedule is generated from (totalAmount - downPayment) = principal
 * 3. So schedule amounts already exclude down payment
 * 
 * @param schedule - The installment schedule array (generated from principal, excluding down payment)
 * @returns The total remaining balance (sum of unpaid installment amounts only)
 */
export function calculateRemainingBalance(schedule: Array<{
  amount?: number;
  paidAmount?: number;
  status?: string;
}>): number {
  if (!Array.isArray(schedule)) {
    return 0;
  }
  
  // Sum only unpaid installments from schedule
  // Schedule is generated from (totalAmount - downPayment), so down payment is already excluded
  return schedule.reduce((sum, item) => {
    const amt = Number(item.amount || 0);
    const paid = Number(item.paidAmount || 0);
    // Only count if not fully paid
    if (item.status === 'pending' || paid < amt) {
      return sum + Math.max(0, amt - paid);
    }
    return sum;
  }, 0);
}

export default { amortizedMonthlyPayment, generateSchedule, calculateRemainingBalance };
