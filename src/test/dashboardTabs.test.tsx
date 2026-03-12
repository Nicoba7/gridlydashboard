import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SimplifiedDashboard from "../pages/SimplifiedDashboard";

describe("SimplifiedDashboard tabs", () => {
  it("renders Home, Plan, and History without crashing", () => {
    render(<SimplifiedDashboard />);

    expect(screen.getByText("RIGHT NOW")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Plan" }).at(-1)!);
    expect(screen.getByText("Tonight's plan")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "History" }).at(-1)!);
    expect(screen.getByText("Your savings")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Home" }).at(-1)!);
    expect(screen.getByText("RIGHT NOW")).toBeInTheDocument();
  });
});
