output "cluster_name" {
  value = module.eks.cluster_name
}

output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "vpc_id" {
  value = module.vpc.vpc_id
}

output "ecr_repository_url" {
  description = "Set as the Helm image.repository value and in CI/CD"
  value       = aws_ecr_repository.helpdesk_api.repository_url
}

output "github_actions_role_arn" {
  description = "Set as the AWS_ROLE_ARN GitHub Actions variable/secret for OIDC auth"
  value       = aws_iam_role.github_actions.arn
}

output "external_secrets_role_arn" {
  description = "Annotate the `external-secrets` ServiceAccount with this ARN"
  value       = aws_iam_role.external_secrets.arn
}

output "helpdesk_api_role_arn" {
  description = "Set as serviceAccount.annotations in Helm values"
  value       = aws_iam_role.helpdesk_api.arn
}
