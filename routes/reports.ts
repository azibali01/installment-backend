import express, { type Request, type Response } from "express";
import { authenticate, authorizePermission } from "../middleware/auth.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import InstallmentPlan from "../models/InstallmentPlan.js";
import User from "../models/User.js";
import { type PipelineStage } from "mongoose";
import PDFDocument from "pdfkit";

const router = express.Router();


// DEBUG ROUTE: Scan all InstallmentPlan documents for totalAmount issues
router.get(
  "/debug/scan-total-amounts",
  async (req, res) => {
    try {
      const plans = await InstallmentPlan.find({}, { installmentId: 1, totalAmount: 1 });
      let sum = 0;
      const issues: any[] = [];
      const details: Array<{ installmentId: any; value: string | number; type: string; numericValue: number; valid: boolean }> = plans.map(plan => {
        const value: string | number = plan.totalAmount;
        const type = typeof value;
        let numericValue: number = 0;
        let valid = true;
        if (typeof value === 'string') {
          numericValue = Number((value as string).replace(/,/g, ''));
          if (isNaN(numericValue)) valid = false;
        } else if (typeof value === 'number') {
          numericValue = value;
        }
        if (valid) sum += numericValue;
        else issues.push({ installmentId: plan.installmentId, value, type });
        return { installmentId: plan.installmentId, value, type, numericValue, valid };
      });
      res.json({
        totalPlans: plans.length,
        sumOfValidTotalAmounts: sum,
        issues,
        details
      });
    } catch (error) {
      console.error('PERMANENT DEBUG: Error in /dashboard route:', error);
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate dashboard",
        });
    }
  }
);

// DASHBOARD ROUTE: Returns totalRevenue (sum of all InstallmentPlan totalAmount fields)
router.get(
  "/dashboard",
  async (req, res) => {
    try {
      // totalRevenue (sum of totalAmount)
      const plansForRevenue = await InstallmentPlan.find({}, { totalAmount: 1 });
      let totalRevenue = 0;
      for (const p of plansForRevenue) {
        let v: any = p.totalAmount as any;
        if (typeof v === "string") v = Number(String(v).replace(/,/g, ""));
        if (typeof v === "number" && !isNaN(v)) totalRevenue += v;
      }

      // totalRemainingRevenue: sum of remainingBalance
      const plansForRemaining = await InstallmentPlan.find({}, { remainingBalance: 1 });
      const totalRemainingRevenue = plansForRemaining.reduce((acc: number, pl: any) => acc + (Number(pl.remainingBalance) || 0), 0);

      // totalCashIn (sum of payments excluding reversed)
      const paymentsAgg = await Payment.aggregate([
        { $match: { status: { $ne: "reversed" } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalCashIn = paymentsAgg[0]?.total || 0;

      // totalCashOut (sum of expenses)
      const expensesAgg = await Expense.aggregate([
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalCashOut = expensesAgg[0]?.total || 0;

      // Build today/upcoming/overdue lists by scanning installment schedules
      const allPlans = await InstallmentPlan.find()
        .populate("customerId", "name phone customerId")
        .lean();

      const todayList: any[] = [];
      const upcomingList: any[] = [];
      const overdueList: any[] = [];

      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0,0,0,0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23,59,59,999);
      const upcomingEnd = new Date(todayEnd);
      upcomingEnd.setDate(upcomingEnd.getDate() + 7); // next 7 days

      for (const plan of allPlans) {
        const planId = plan.installmentId || (plan._id ? String(plan._id) : undefined);
        const customer = plan.customerId && typeof plan.customerId === 'object' ? plan.customerId : { _id: plan.customerId };
        const schedule = Array.isArray(plan.installmentSchedule) ? plan.installmentSchedule : [];
        for (const item of schedule) {
          const due = item?.dueDate ? new Date(item.dueDate) : null;
          const amount = Number(item?.amount || 0);
          const paidAmount = Number(item?.paidAmount || 0);
          const remaining = Math.max(0, amount - paidAmount);
          if (!due || remaining <= 0) continue;

          const entry = {
            planId: planId,
            customer: customer,
            installment: {
              month: item.month,
              dueDate: due?.toISOString(),
              amount,
              paidAmount,
              remaining,
            },
          };

          if (due >= todayStart && due <= todayEnd) {
            todayList.push(entry);
          } else if (due > todayEnd && due <= upcomingEnd) {
            upcomingList.push(entry);
          } else if (due < todayStart) {
            overdueList.push(entry);
          }
        }
      }

      res.json({
        totalRevenue,
        totalRemainingRevenue,
        totalCashIn,
        totalCashOut,
        today: { count: todayList.length },
        upcoming: { count: upcomingList.length },
        overdue: { count: overdueList.length },
        todayList,
        upcomingList,
        overdueList,
      });
    } catch (error) {
      console.error('PERMANENT DEBUG: Error in /dashboard route:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to generate dashboard",
      });
    }
  }
);

router.get(
  "/download-pdf",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "User not authenticated" });
      }

      // Get user's cash balance
      const user = await User.findById(userId).select("name email cashBalance");
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Get total collected (System wide)
      const payments = await Payment.aggregate([
        { $match: { status: { $ne: "reversed" } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);
      const totalCollected = payments[0]?.total || 0;

      // Get all remaining installments (plans with pending installments)
      const allPlans = await InstallmentPlan.find({
        status: { $in: ["approved", "pending"] },
      })
        .populate("customerId", "name phone customerId")
        .populate("productId", "name price")
        .lean();

      // Filter plans that have remaining installments
      const plansWithRemaining = allPlans.filter((plan: any) => {
        if (!plan.installmentSchedule || !Array.isArray(plan.installmentSchedule)) {
          return false;
        }
        return plan.installmentSchedule.some(
          (schedule: any) =>
            schedule.status === "pending" &&
            (schedule.paidAmount || 0) < (schedule.amount || 0)
        );
      });

      // Calculate remaining amounts for each plan
      const remainingInstallments = plansWithRemaining.map((plan: any) => {
        const remainingSchedule = (plan.installmentSchedule || []).filter(
          (schedule: any) =>
            schedule.status === "pending" &&
            (schedule.paidAmount || 0) < (schedule.amount || 0)
        );

        const totalRemaining = remainingSchedule.reduce(
          (sum: number, schedule: any) => {
            const remaining = (schedule.amount || 0) - (schedule.paidAmount || 0);
            return sum + remaining;
          },
          0
        );

        return {
          installmentId: plan.installmentId || plan._id.toString().slice(-6),
          customerName:
            typeof plan.customerId === "object"
              ? plan.customerId?.name || "N/A"
              : "N/A",
          customerPhone:
            typeof plan.customerId === "object"
              ? plan.customerId?.phone || "N/A"
              : "N/A",
          productName:
            typeof plan.productId === "object"
              ? plan.productId?.name || "N/A"
              : "N/A",
          totalRemaining,
          remainingCount: remainingSchedule.length,
          nextDueDate:
            remainingSchedule.length > 0
              ? remainingSchedule[0].dueDate
              : null,
        };
      });

      // Get all expenses
      const expenses = await Expense.find()
        .populate("userId", "name")
        .populate("relatedUser", "name")
        .sort({ date: -1 })
        .lean();

      // Calculate total expenses
      const totalExpenses = expenses.reduce(
        (sum: number, exp: any) => sum + (exp.amount || 0),
        0
      );

      // Create PDF with better margins
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4',
        info: {
          Title: 'Installment Management Report',
          Author: user.name,
          Subject: 'Financial Report',
          Creator: 'Installment Management System'
        }
      });
      const filename = `report-${new Date().toISOString().split("T")[0]}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`
      );

      doc.pipe(res);

      // Color definitions (RGB format for PDFKit)
      const primaryColor = '#2563eb'; // Blue
      const successColor = '#10b981'; // Green
      const warningColor = '#f59e0b'; // Orange
      const dangerColor = '#ef4444'; // Red
      const darkGray = '#1f2937';
      const lightGray = '#f3f4f6';
      const borderGray = '#e5e7eb';

      // Helper function to draw colored box
      const drawColoredBox = (x: number, y: number, width: number, height: number, hexColor: string) => {
        doc.rect(x, y, width, height).fillColor(hexColor).fill();
      };

      // Helper function to draw rounded rectangle
      const drawRoundedRect = (x: number, y: number, width: number, height: number, radius: number, hexColor: string) => {
        doc.roundedRect(x, y, width, height, radius).fillColor(hexColor).fill();
      };

      // Header with colored background
      const headerHeight = 80;
      drawColoredBox(0, 0, doc.page.width, headerHeight, primaryColor);
      
      doc.fillColor('#ffffff')
         .fontSize(24)
         .font('Helvetica-Bold')
         .text("Installment Management Report", 50, 30, { align: "center", width: doc.page.width - 100 });
      
      doc.fontSize(11)
         .font('Helvetica')
         .text(`Generated on: ${new Date().toLocaleString()}`, 50, 60, { align: "center", width: doc.page.width - 100 });
      
      doc.fillColor('black'); // Reset to black
      let yPos = headerHeight + 30;

      // Financial Overview Section
      doc.fillColor(darkGray)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Financial Overview", 50, yPos);
      
      yPos += 25;

      // Draw 4 cards for overview
      const cardWidth = (doc.page.width - 100 - 30) / 2; // 2 columns
      const cardHeight = 80;
      
      // Card 1: Cash in Hand (User)
      drawRoundedRect(50, yPos, cardWidth, cardHeight, 8, '#ecfdf5'); // Green bg
      doc.roundedRect(50, yPos, cardWidth, cardHeight, 8).lineWidth(1).strokeColor(successColor).stroke();
      
      doc.fillColor(darkGray).fontSize(10).text("My Cash Balance", 65, yPos + 15);
      doc.fillColor(successColor).fontSize(16).font('Helvetica-Bold').text(`PKR ${user.cashBalance?.toLocaleString() || "0"}`, 65, yPos + 35);

      // Card 2: Total Collected (System)
      drawRoundedRect(50 + cardWidth + 30, yPos, cardWidth, cardHeight, 8, '#eff6ff'); // Blue bg
      doc.roundedRect(50 + cardWidth + 30, yPos, cardWidth, cardHeight, 8).lineWidth(1).strokeColor(primaryColor).stroke();
      
      doc.fillColor(darkGray).fontSize(10).font('Helvetica-Bold').text("Total Collected (System)", 65 + cardWidth + 30, yPos + 15);
      doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold').text(`PKR ${totalCollected.toLocaleString()}`, 65 + cardWidth + 30, yPos + 35);

      yPos += cardHeight + 20;

      // Card 3: Total Expenses
      drawRoundedRect(50, yPos, cardWidth, cardHeight, 8, '#fef2f2'); // Red bg
      doc.roundedRect(50, yPos, cardWidth, cardHeight, 8).lineWidth(1).strokeColor(dangerColor).stroke();
      
      doc.fillColor(darkGray).fontSize(10).font('Helvetica-Bold').text("Total Expenses", 65, yPos + 15);
      doc.fillColor(dangerColor).fontSize(16).font('Helvetica-Bold').text(`PKR ${totalExpenses.toLocaleString()}`, 65, yPos + 35);

      // Card 4: Net Profit (Collected - Expenses)
      const netProfit = totalCollected - totalExpenses;
      const profitColor = netProfit >= 0 ? successColor : dangerColor;
      const profitBg = netProfit >= 0 ? '#ecfdf5' : '#fef2f2';

      drawRoundedRect(50 + cardWidth + 30, yPos, cardWidth, cardHeight, 8, profitBg);
      doc.roundedRect(50 + cardWidth + 30, yPos, cardWidth, cardHeight, 8).lineWidth(1).strokeColor(profitColor).stroke();
      
      doc.fillColor(darkGray).fontSize(10).font('Helvetica-Bold').text("Net Profit", 65 + cardWidth + 30, yPos + 15);
      doc.fillColor(profitColor).fontSize(16).font('Helvetica-Bold').text(`PKR ${netProfit.toLocaleString()}`, 65 + cardWidth + 30, yPos + 35);

      yPos += cardHeight + 30;

      // Remaining Installments Section
      doc.fillColor(primaryColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Remaining Installments", 50, yPos);
      
      yPos += 25;

      if (remainingInstallments.length === 0) {
        doc.fillColor('#374151')
           .fontSize(12)
           .font('Helvetica')
           .text("No remaining installments found.", 70, yPos);
        yPos += 30;
      } else {
        const totalRemaining = remainingInstallments.reduce(
          (sum, plan) => sum + plan.totalRemaining,
          0
        );

        // Summary text
        doc.fillColor(darkGray)
           .fontSize(12)
           .font('Helvetica-Bold')
           .text(`Total Plans: ${remainingInstallments.length} | Total Remaining: PKR ${totalRemaining.toLocaleString()}`, 50, yPos);

        yPos += 20;

        // Table header with colored background
        const tableHeaderY = yPos;
        const headerHeight = 25;
        drawRoundedRect(50, tableHeaderY, doc.page.width - 100, headerHeight, 4, primaryColor);
        
        doc.fillColor('#ffffff')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text("ID", 60, tableHeaderY + 7);
        doc.text("Customer", 120, tableHeaderY + 7);
        doc.text("Product", 250, tableHeaderY + 7);
        doc.text("Remaining", 350, tableHeaderY + 7);
        doc.text("Count", 450, tableHeaderY + 7);
        doc.text("Next Due", 500, tableHeaderY + 7);

        yPos = tableHeaderY + headerHeight + 5;
        doc.fillColor('black'); // Reset to black

        // Table rows with alternating colors
        remainingInstallments.forEach((plan, index) => {
          if (yPos > 700) {
            // New page if needed
            doc.addPage();
            yPos = 50;
            // Redraw header on new page
            const newHeaderY = yPos;
            drawRoundedRect(50, newHeaderY, doc.page.width - 100, headerHeight, 4, primaryColor);
            doc.fillColor('#ffffff')
               .fontSize(10)
               .font('Helvetica-Bold')
               .text("ID", 60, newHeaderY + 7);
            doc.text("Customer", 120, newHeaderY + 7);
            doc.text("Product", 250, newHeaderY + 7);
            doc.text("Remaining", 350, newHeaderY + 7);
            doc.text("Count", 450, newHeaderY + 7);
            doc.text("Next Due", 500, newHeaderY + 7);
            yPos = newHeaderY + headerHeight + 5;
            doc.fillColor('black');
          }

          // Alternate row colors
          if (index % 2 === 0) {
            doc.rect(50, yPos - 5, doc.page.width - 100, 18)
               .fillColor(lightGray)
               .fill();
          }

          doc.fillColor('black')
             .fontSize(9)
             .font('Helvetica')
             .text(plan.installmentId || "N/A", 60, yPos);
          
          doc.text(plan.customerName.substring(0, 18), 120, yPos, {
            width: 130,
            ellipsis: true,
          });
          
          doc.text(plan.productName.substring(0, 18), 250, yPos, {
            width: 100,
            ellipsis: true,
          });
          
          doc.fillColor(warningColor)
             .font('Helvetica-Bold')
             .text(`PKR ${plan.totalRemaining.toLocaleString()}`, 350, yPos);
          
          doc.fillColor('black')
             .font('Helvetica')
             .text(String(plan.remainingCount), 450, yPos);
          
          if (plan.nextDueDate) {
            const dueDate = new Date(plan.nextDueDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            dueDate.setHours(0, 0, 0, 0);
            
            if (dueDate < today) {
              doc.fillColor(dangerColor); // Red for overdue
            } else {
              doc.fillColor('#374151'); // Gray for future dates
            }
            
            doc.text(dueDate.toLocaleDateString(), 500, yPos);
          } else {
            doc.fillColor('#374151')
               .text("N/A", 500, yPos);
          }

          yPos += 18;
        });

        // Table bottom border
        doc.moveTo(50, yPos - 5)
           .lineTo(doc.page.width - 50, yPos - 5)
           .lineWidth(1)
           .strokeColor(borderGray)
           .stroke();
        
        yPos += 15;
      }

      // Expenses Section
      doc.fillColor(dangerColor)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text("Recent Expenses", 50, yPos);
      
      yPos += 25;

      if (expenses.length > 0) {
        // Expense table header with colored background
        const expenseHeaderY = yPos;
        const expenseHeaderHeight = 25;
        drawRoundedRect(50, expenseHeaderY, doc.page.width - 100, expenseHeaderHeight, 4, dangerColor);
        
        doc.fillColor('#ffffff')
           .fontSize(10)
           .font('Helvetica-Bold')
           .text("Date", 60, expenseHeaderY + 7);
        doc.text("Category", 120, expenseHeaderY + 7);
        doc.text("Amount", 250, expenseHeaderY + 7);
        doc.text("Description", 320, expenseHeaderY + 7);
        doc.text("User", 450, expenseHeaderY + 7);

        yPos = expenseHeaderY + expenseHeaderHeight + 5;
        doc.fillColor('black'); // Reset to black

        // Show last 50 expenses to avoid PDF being too large
        const expensesToShow = expenses.slice(0, 50);
        expensesToShow.forEach((exp: any, index: number) => {
          if (yPos > 700) {
            doc.addPage();
            yPos = 50;
            // Redraw header on new page
            const newExpenseHeaderY = yPos;
            drawRoundedRect(50, newExpenseHeaderY, doc.page.width - 100, expenseHeaderHeight, 4, dangerColor);
            doc.fillColor('#ffffff')
               .fontSize(10)
               .font('Helvetica-Bold')
               .text("Date", 60, newExpenseHeaderY + 7);
            doc.text("Category", 120, newExpenseHeaderY + 7);
            doc.text("Amount", 250, newExpenseHeaderY + 7);
            doc.text("Description", 320, newExpenseHeaderY + 7);
            doc.text("User", 450, newExpenseHeaderY + 7);
            yPos = newExpenseHeaderY + expenseHeaderHeight + 5;
            doc.fillColor('black');
          }

          // Alternate row colors
          if (index % 2 === 0) {
            doc.rect(50, yPos - 5, doc.page.width - 100, 18)
               .fillColor(lightGray)
               .fill();
          }

          doc.fillColor('black')
             .fontSize(9)
             .font('Helvetica')
             .text(
               new Date(exp.date).toLocaleDateString(),
               60,
               yPos
             );
          
          // Category with color coding
          const categoryColors: Record<string, string> = {
            salary: '#3b82f6',
            rent: '#8b5cf6',
            utilities: '#06b6d4',
            inventory_purchase: '#10b981',
            supplies: '#f59e0b',
            marketing: '#ec4899',
            maintenance: '#ef4444',
            logistics: '#6366f1',
            taxes: '#f97316',
            other: '#6b7280'
          };
          
          const categoryColor = categoryColors[exp.category] || '#6b7280';
          doc.fillColor(categoryColor)
             .font('Helvetica-Bold')
             .text((exp.category || "N/A").replace('_', ' ').toUpperCase(), 120, yPos, { width: 130 });
          
          doc.fillColor(dangerColor)
             .font('Helvetica-Bold')
             .text(`PKR ${(exp.amount || 0).toLocaleString()}`, 250, yPos);
          
          doc.fillColor('black')
             .font('Helvetica')
             .text((exp.description || "N/A").substring(0, 28), 320, yPos, {
               width: 130,
               ellipsis: true,
             });
          
          const userName =
            typeof exp.userId === "object" ? exp.userId?.name || "N/A" : "N/A";
          doc.text(userName.substring(0, 18), 450, yPos, {
            width: 100,
            ellipsis: true,
          });

          yPos += 18;
        });

        // Table bottom border
        doc.moveTo(50, yPos - 5)
           .lineTo(doc.page.width - 50, yPos - 5)
           .lineWidth(1)
           .strokeColor(borderGray)
           .stroke();

        if (expenses.length > 50) {
          yPos += 10;
          doc.fillColor('#374151')
             .fontSize(9)
             .font('Helvetica-Oblique')
             .text(
               `... and ${expenses.length - 50} more expense records`,
               70,
               yPos
             );
        }
      }

      // Footer with colored background
      const footerY = doc.page.height - 40;
      doc.rect(0, footerY, doc.page.width, 40)
         .fillColor(lightGray)
         .fill();
      
      doc.fillColor('#374151')
         .fontSize(9)
         .font('Helvetica')
         .text(
           `Report generated by ${user.name} on ${new Date().toLocaleString()}`,
           50,
           footerY + 15,
           { align: "center", width: doc.page.width - 100 }
         );
      
      doc.fillColor(primaryColor)
         .fontSize(8)
         .text(
           "Installment Management System",
           50,
           footerY + 30,
           { align: "center", width: doc.page.width - 100 }
         );

      doc.end();
    } catch (error) {
      console.error("PDF generation error:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate PDF report",
      });
    }
  }
);

export default router;
