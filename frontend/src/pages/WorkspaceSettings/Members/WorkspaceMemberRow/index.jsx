import { titleCase } from "text-case";
import { displayName } from "@/utils/displayName";

export default function WorkspaceMemberRow({ user }) {
  return (
    <>
      <tr className="bg-transparent text-theme-text-primary text-sm font-medium">
        <th scope="row" className="px-6 py-4 whitespace-nowrap">
          {displayName(user)}
        </th>
        <td className="px-6 py-4">{titleCase(user.role)}</td>
        <td className="px-6 py-4">{user.lastUpdatedAt}</td>
      </tr>
    </>
  );
}
