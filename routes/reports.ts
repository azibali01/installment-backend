import express, { type Request, type Response } from "express";
import { authenticate, authorizePermission } from "../middleware/auth.js";
import Payment from "../models/Payment.js";
import Expense from "../models/Expense.js";
import InstallmentPlan from "../models/InstallmentPlan.js";
import { type PipelineStage } from "mongoose";

const router = express.Router();

router.get(
  "/cash-flow",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const { startDate, endDate } = req.query;

      const query: any = {};
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate as string);
        if (endDate) query.createdAt.$lte = new Date(endDate as string);
      }

      const cashIn = await Payment.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const cashOut = await Expense.aggregate([
        { $match: query },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const totalCashIn = cashIn[0]?.total || 0;
      const totalCashOut = cashOut[0]?.total || 0;

      res.json({
        totalCashIn,
        totalCashOut,
        profit: totalCashIn - totalCashOut,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate report",
        });
    }
  }
);

router.get(
  "/installment-status",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const overdue = await InstallmentPlan.find({
        "installmentSchedule.dueDate": { $lt: today },
        "installmentSchedule.status": "pending",
      });

      const duToday = await InstallmentPlan.find({
        "installmentSchedule.dueDate": today,
        "installmentSchedule.status": "pending",
      });

      const upcoming = await InstallmentPlan.find({
        "installmentSchedule.dueDate": { $gt: today },
        "installmentSchedule.status": "pending",
      }).limit(10);

      res.json({ overdue, duToday, upcoming });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to generate report",
        });
    }
  }
);

router.get(
  "/dashboard",
  authenticate,
  authorizePermission("view_reports"),
  async (req: Request, res: Response) => {
    try {
      const windowDays = Math.max(1, Number(req.query.windowDays || 7));

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const upcomingEnd = new Date(startOfDay);
      upcomingEnd.setDate(upcomingEnd.getDate() + windowDays);
      upcomingEnd.setHours(23, 59, 59, 999);

      const baseUnwind: PipelineStage[] = [
        { $unwind: "$installmentSchedule" },
        {
          $addFields: {
            "installmentSchedule.remaining": {
              $subtract: [
                "$installmentSchedule.amount",
                { $ifNull: ["$installmentSchedule.paidAmount", 0] },
              ],
            },
          },
        },
        { $match: { "installmentSchedule.remaining": { $gt: 0 } } },
      ];

      const makeCountPipeline = (dateMatch: any): PipelineStage[] => [
        ...baseUnwind,
        { $match: dateMatch },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            totalRemaining: { $sum: "$installmentSchedule.remaining" },
          },
        },
      ];

      const makeListPipeline = (
        dateMatch: any,
        limit = 10
      ): PipelineStage[] => [
        ...baseUnwind,
        { $match: dateMatch },
        {
          $lookup: {
            from: "customers",
            localField: "customerId",
            foreignField: "_id",
            as: "customer",
          },
        },
        { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            planId: "$_id",
            installment: "$installmentSchedule",
            customer: {
              _id: "$customer._id",
              name: "$customer.name",
              phone: "$customer.phone",
            },
            productId: 1,
          },
        },
        { $sort: { "installment.dueDate": 1 } },
        { $limit: limit },
      ];

      const [
        todayAgg,
        upcomingAgg,
        overdueAgg,
        todayList,
        upcomingList,
        overdueList,
        cashInAgg,
        cashOutAgg,
      ] = await Promise.all([
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $gte: startOfDay, $lte: endOfDay },
          })
        ),
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $gt: endOfDay, $lte: upcomingEnd },
          })
        ),
        InstallmentPlan.aggregate(
          makeCountPipeline({
            "installmentSchedule.dueDate": { $lt: startOfDay },
          })
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            {
              "installmentSchedule.dueDate": {
                $gte: startOfDay,
                $lte: endOfDay,
              },
            },
            10
          )
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            {
              "installmentSchedule.dueDate": {
                $gt: endOfDay,
                $lte: upcomingEnd,
              },
            },
            10
          )
        ),
        InstallmentPlan.aggregate(
          makeListPipeline(
            { "installmentSchedule.dueDate": { $lt: startOfDay } },
            10
          )
        ),
        Payment.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
        Expense.aggregate([
          { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
      ]);

      const normalize = (arr: any[]) =>
        arr[0]
          ? { count: arr[0].count, totalRemaining: arr[0].totalRemaining }
          : { count: 0, totalRemaining: 0 };

      const totalCashIn = cashInAgg[0]?.total || 0;
      const totalCashOut = cashOutAgg[0]?.total || 0;

      res.json({
        today: normalize(todayAgg),
        upcoming: normalize(upcomingAgg),
        overdue: normalize(overdueAgg),
        todayList,
        upcomingList,
        overdueList,
        totalCashIn,
        totalCashOut,
      });
    } catch (error) {
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

export default router;
